export const BASE_URL = "https://jobnet.dk/bff"
export const USER_AGENT = "Mozilla/5.0 (compatible; jobnet-cli/1.0)"

export async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  let url = `${BASE_URL}${path}`
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params)
    url += `?${qs.toString()}`
  }

  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "x-csrf": "1",
      },
      signal: AbortSignal.timeout(15000),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      // Add jitter to spread out retries: base delay + random 0-500ms
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
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

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

const RAW_TEXT_TAGS = new Set(["script", "style"])

function attributes(attrs: string): Array<[string, string]> {
  return [...attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((m) => [
    m[1].toLowerCase(),
    m[2] ?? m[3] ?? m[4] ?? "",
  ])
}

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: Array<[string, string]>): boolean {
  return attrs.some(
    ([name, value]) =>
      name === "hidden" ||
      (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)),
  )
}

// The raw value is checked, so an entity-encoded scheme fails to parse rather than slipping past.
function isWebUrl(href: string): boolean {
  try {
    return /^https?:$/.test(new URL(href).protocol)
  } catch {
    return false
  }
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, elements marked
 * hidden, and every attribute but an http(s) href - before tags are stripped. A plain
 * tag strip keeps their text, which hands the model words the posting's
 * reader never saw. CSS-only tricks (off-screen, zero font size) need a
 * renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  // Quoted attribute values may hold `>` or a close tag; an unterminated one runs to the end, as in a browser.
  const token = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^"'>])*)(?:>|$)/g
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const kept: string[] = []
  let from = 0
  let hidden: string | null = null
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = token.exec(html)) !== null) {
    const [, close, name, rawAttrs] = m
    const tag = name?.toLowerCase()
    let end = token.lastIndex
    if (tag && !close && RAW_TEXT_TAGS.has(tag)) {
      const rawEnd = new RegExp(`</${tag}\\s*>`, "gi")
      rawEnd.lastIndex = end
      end = rawEnd.exec(html) ? rawEnd.lastIndex : html.length
      token.lastIndex = end
    }
    if (hidden) {
      // An unclosed hidden element runs to the end: failing closed drops visible text, failing open would leak.
      if (tag === hidden && (depth += close ? -1 : 1) === 0) {
        hidden = null
        from = end
      }
      continue
    }
    kept.push(html.slice(from, m.index))
    from = end
    if (!tag || RAW_TEXT_TAGS.has(tag)) continue
    if (close) {
      kept.push(`</${tag}>`)
      continue
    }
    const attrs = attributes(rawAttrs)
    if (tag === "template" || isHiddenTag(attrs)) {
      if (!VOID_TAGS.has(tag)) {
        hidden = tag
        depth = 1
      }
      continue
    }
    const href = attrs.find(([attr]) => attr === "href")?.[1]
    kept.push(href === undefined || !isWebUrl(href) ? `<${tag}>` : `<${tag} href="${href.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">`)
  }
  if (!hidden) kept.push(html.slice(from))
  return kept.join("")
}

export function stripHtml(html: string): string {
  return visibleHtml(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeJobId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  let url: URL
  try {
    const hostLike = /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)
    url = new URL(hostLike ? `https://${trimmed}` : trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.hostname !== "jobnet.dk" && !url.hostname.endsWith(".jobnet.dk")) return null
  // Otherwise an unrelated site's matching path silently selects a Jobnet ad.
  // Keep legacy routes, but never interpret a query or fragment as a job path.
  const match = url.pathname.match(/(?:\/find-job\/|\/JobAdDetails\/|\/Details\/)(?:detaljer\/)?([a-zA-Z0-9_-]+)(?:\/|$)/i)
  if (match) return match[1]
  return null
}

