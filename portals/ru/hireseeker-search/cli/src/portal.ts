import { clean, visibleHtml, stripInvisible } from "./text.ts"

export const ORIGIN = "https://hireseeker.ru"
export class PortalError extends Error {
  constructor(message: string, public code: string) { super(message) }
}
export interface Job {
  id: string; title: string; company: string | null; location: null; date: null
  url: string; seen_at: string | null; description?: string | null
}
export function publicURL(input: string): URL {
  let url: URL
  try { url = new URL(input, ORIGIN) }
  catch { throw new PortalError("Invalid public URL", "BAD_URL") }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      !/^\/(?:robots\.txt|llms\.txt|vacancy-list\/[a-z][a-z0-9_]*|vacancy\/\d+(?:-[a-z0-9-]+)?)$/.test(url.pathname)) {
    throw new PortalError("Only HireSeeker public catalog and vacancy URLs are allowed", "BAD_URL")
  }
  return url
}

// Current policies use plain prefixes. Unknown wildcard policies fail closed.
export function permitted(robots: string, path: string): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] }
  const groups: Group[] = []
  let group: Group = { agents: [], rules: [] }
  for (const raw of robots.split(/\r?\n/)) {
    const match = raw.split("#")[0].trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i)
    if (!match) continue
    const [, key, value] = match
    if (key.toLowerCase() === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] } }
      group.agents.push(value.toLowerCase())
    } else if (group.agents.length && value) group.rules.push({ allow: key.toLowerCase() === "allow", path: value })
  }
  groups.push(group)
  const score = (g: Group) => Math.max(-1, ...g.agents.map(a =>
    a === "*" ? 0 : "hireseeker-search-cli".includes(a) ? a.length : -1))
  const best = Math.max(...groups.map(score))
  if (best < 0) return false
  const rules = groups.filter(g => score(g) === best).flatMap(g => g.rules)
  if (rules.some(r => /[*$]/.test(r.path))) return false
  const matches = rules.filter(r => path.startsWith(r.path)).sort((a, b) =>
    b.path.length - a.path.length || Number(b.allow) - Number(a.allow))
  return matches[0]?.allow ?? true
}

type Sleep = (ms: number) => Promise<unknown>
export async function fetchPage(input: string, robots?: string, fetcher: typeof fetch = fetch,
  sleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<string | null> {
  let url = publicURL(input)
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (url.pathname !== "/robots.txt" && (!robots || !permitted(robots, url.pathname))) {
      throw new PortalError("robots.txt does not permit this path; use WebSearch", "ROBOTS_DENIED")
    }
    let response: Response | undefined
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; hireseeker-search-cli/1.0)", Accept: "text/html,text/plain" } })
      } catch { throw new PortalError("HireSeeker request failed or timed out", "NETWORK_ERROR") }
      if (response.status !== 429 && response.status < 500) break
      await response.body?.cancel()
      if (attempt === 3) throw new PortalError(`HTTP ${response.status} after retries`, "HTTP_ERROR")
      await sleep(250 * 2 ** attempt + Math.random() * 100)
    }
    if (!response) throw new PortalError("No response", "NETWORK_ERROR")
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location")
      await response.body?.cancel()
      if (!next) throw new PortalError("Redirect has no location", "HTTP_ERROR")
      url = publicURL(new URL(next, url).href)
      continue
    }
    if (response.status === 404 || response.status === 410) return null
    if (!response.ok) throw new PortalError(`HTTP ${response.status}; no access workaround`, "HTTP_ERROR")
    if (!/text\/(html|plain)/i.test(response.headers.get("content-type") ?? "")) {
      throw new PortalError("Unexpected response type", "PARSE_ERROR")
    }
    return await response.text()
  }
  throw new PortalError("Too many redirects", "HTTP_ERROR")
}

export function professions(markdown: string): { code: string; name: string }[] {
  const entries = [...markdown.matchAll(/\[([^\]\n]+)\]\(https:\/\/hireseeker\.ru\/vacancy-list\/([a-z][a-z0-9_]*)\)/g)]
  return stripInvisible([...new Map(entries.map(m => [m[2], { code: m[2], name: m[1] }])).values()])
}
export function resolveProfession(query: string, catalog: ReturnType<typeof professions>): string {
  const normalized = query.toLowerCase().trim()
  const exact = catalog.find(p => p.code === normalized || p.name.toLowerCase() === normalized)
  if (exact) return exact.code
  const matches = catalog.filter(p => p.name.toLowerCase().includes(normalized))
  if (matches.length === 1) return matches[0].code
  throw new PortalError("Use a profession code from 'professions'; arbitrary keyword filters are unsupported", "BAD_QUERY")
}

export function parseSearch(html: string): Job[] {
  const source = visibleHtml(html)
  if (!source.includes('data-testid="category-sample"')) throw new PortalError("Public category sample missing; use WebSearch", "PARSE_ERROR")
  const jobs: Job[] = []
  for (const chunk of source.split(/(?=<div\b[^>]*data-vacancy-card=")/).slice(1)) {
    const anchor = chunk.match(/<a\b[^>]*data-testid="vacancy-title-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!anchor) continue
    let url: URL
    try { url = publicURL(anchor[1]) } catch { continue }
    if (!url.pathname.startsWith("/vacancy/")) continue
    const title = clean(anchor[2])
    if (!title) continue
    const company = chunk.match(/<a\b[^>]*href="\/vacancy-list\/company\/[^>]*>([\s\S]*?)<\/a>/)
    const seen = chunk.match(/<time\b[^>]*dateTime="([^"]+)"[^>]*data-testid="vacancy-seen-at"/i)
    jobs.push({ id: url.pathname.split("/")[2].split("-")[0], title,
      company: company ? clean(company[1]) || null : null, location: null, date: null,
      url: url.href, seen_at: seen?.[1] ?? null })
  }
  if (!jobs.length) throw new PortalError("No readable public cards; coverage unknown; use WebSearch", "PARSE_ERROR")
  return stripInvisible([...new Map(jobs.map(job => [job.id, job])).values()])
}
export function parseDetail(html: string, input: string): Job {
  const source = visibleHtml(html)
  const header = source.match(/<header\b[^>]*>([\s\S]*?<h1\b[\s\S]*?)<\/header>/)?.[1]
  const title = header?.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1]
  const description = source.match(/<section\b[^>]*id="vacancy-description"[^>]*>([\s\S]*?)<\/section>/)?.[1]
  if (!title || !description || !clean(title) || !clean(description)) throw new PortalError("Readable vacancy header/description missing", "PARSE_ERROR")
  const company = header?.match(/<(?:span|a)\b[^>]*class="font-medium text-foreground\/80[^>]*>([\s\S]*?)<\/(?:span|a)>/)?.[1]
  const employer = company ? clean(company) || null : null
  const seen = header?.match(/<time\b[^>]*dateTime="([^"]+)"[^>]*data-testid="vacancy-seen-at"/i)?.[1]
  const url = publicURL(input)
  return stripInvisible({ id: url.pathname.split("/")[2].split("-")[0], title: clean(title),
    company: employer === "Неизвестный работодатель" ? null : employer, location: null, date: null,
    url: url.href, seen_at: seen ?? null, description: clean(description) })
}
