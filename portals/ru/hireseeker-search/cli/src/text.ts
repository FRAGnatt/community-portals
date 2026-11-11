// Adapted from linkedin-search in this MIT-licensed repository.
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: "\u00a0", colon: ":", semi: ";", Tab: "\t", NewLine: "\n" }
  // One pass: &amp;lt; is visible literal &lt;, not a second encoding layer.
  return text.replace(/&(?:#(\d+);?|#[xX]([\da-fA-F]+);?|(amp|lt|gt|quot|apos|nbsp|colon|semi|Tab|NewLine);)/g,
    (_, dec: string | undefined, hex: string | undefined, name: string) =>
      dec !== undefined ? numericEntity(parseInt(dec, 10)) : hex !== undefined ? numericEntity(parseInt(hex, 16)) : named[name])
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

// Quoted attribute values may hold `>` or a close-tag string; neither ends the tag.
const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`

export function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const match of source.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1].toLowerCase()
    // HTML uses the first occurrence of a duplicate attribute.
    if (!Object.hasOwn(result, name)) result[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "")
  }
  return result
}

export function* htmlTags(html: string, name = "[a-zA-Z][a-zA-Z0-9-]*") {
  const pattern = new RegExp(`<(/?)(${name})(?=[\\s/>])(\\s${ATTRS})?\\s*/?>`, "gi")
  for (const match of html.matchAll(pattern)) yield {
    name: match[2].toLowerCase(), closing: Boolean(match[1]), attributes: attributes(match[3] ?? ""),
    start: match.index!, end: match.index! + match[0].length, voidElement: VOID_TAGS.has(match[2].toLowerCase()),
  }
}

export function elements(html: string, name: string, select: (attrs: Record<string, string>) => boolean = () => true) {
  type Tag = ReturnType<typeof htmlTags> extends Generator<infer T> ? T : never
  const stack: { tag: Tag; selected: boolean }[] = []
  const found: { attributes: Record<string, string>; content: string; start: number }[] = []
  for (const tag of htmlTags(html, name)) {
    if (!tag.closing) {
      if (!tag.voidElement) stack.push({ tag, selected: select(tag.attributes) })
    } else {
      const open = stack.pop()
      if (open?.selected) found.push({ attributes: open.tag.attributes,
        content: html.slice(open.tag.end, tag.start), start: open.tag.start })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const [name, value] of Object.entries(attributes(attrs))) {
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)(\\s${ATTRS})?>`, "g")
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag)) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      // Every tag is matched whole, so a close tag inside a quoted attribute is skipped.
      const same = new RegExp(`<(/?)([a-zA-Z][a-zA-Z0-9-]*)${ATTRS}>`, "g")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[2].toLowerCase() !== tag) continue
        if (s[1]) depth--
        else depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

export function clean(html: string): string {
  return stripInvisible(decodeHtmlEntities(visibleHtml(html).replace(new RegExp(`</?[a-zA-Z][a-zA-Z0-9-]*(?=[\\s/>])${ATTRS}>`, "g"), " ")))
    .replace(/\s+/g, " ").trim()
}
