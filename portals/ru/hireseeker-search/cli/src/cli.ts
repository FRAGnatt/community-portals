#!/usr/bin/env bun
import { fetchPage, ORIGIN, parseDetail, parseSearch, PortalError, professions, publicURL, resolveProfession } from "./portal.ts"
import { stripInvisible } from "./text.ts"

const HELP = `hireseeker-search — public HTML only; Russia/CIS-focused IT and digital roles
  professions [--format json|table|plain]
  search --query <profession code or unique catalog label> [--page 1] [--limit N] [--format json|table|plain]
  detail <id|public URL> [--format json|plain]
Search reads the public category's limited sample, not the full catalog.
No arbitrary keyword, location or jobage filter. Use WebSearch for other criteria.
`
export async function main(argv: string[], fetcher: typeof fetch = fetch): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(HELP); return }
  const [command, ...args] = argv
  if (!["search", "detail", "professions"].includes(command)) throw new PortalError("Expected search, detail or professions; see --help", "BAD_ARG")
  const allowed = command === "search" ? ["query", "page", "limit", "format"] : ["format"]
  const flags: Record<string, string> = {}
  const positional: string[] = []
  const aliases: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith("-")) { positional.push(arg); continue }
    const key = aliases[arg.replace(/^-+/, "")] ?? arg.replace(/^-+/, "")
    if (!allowed.includes(key)) throw new PortalError(`Unsupported flag ${arg}; filters are never silently ignored`, "UNKNOWN_FLAG")
    const value = args[++i]
    if (!value?.trim() || value.startsWith("-") || flags[key] !== undefined) throw new PortalError(`Flag ${arg} needs one nonempty value`, "BAD_ARG")
    flags[key] = value
  }
  const format = flags.format ?? "json"
  if (!(command === "detail" ? ["json", "plain"] : ["json", "table", "plain"]).includes(format)) throw new PortalError("Unsupported format", "BAD_ARG")
  if (positional.length !== (command === "detail" ? 1 : 0)) throw new PortalError("Unexpected or missing positional argument", "BAD_ARG")
  if (flags.page !== undefined && flags.page !== "1") throw new PortalError("Public SSR sample has no supported pagination; only --page 1", "UNSUPPORTED_FILTER")
  const limit = flags.limit === undefined ? undefined : Number(flags.limit)
  if (flags.limit !== undefined && (!/^[1-9]\d*$/.test(flags.limit) || !Number.isSafeInteger(limit))) throw new PortalError("--limit must be a positive integer", "BAD_ARG")
  if (command === "search" && !flags.query?.trim()) throw new PortalError("--query/-q is required; use professions to discover values", "BAD_ARG")
  const detailURL = command === "detail" ? publicURL(/^\d+$/.test(positional[0]) ? `/vacancy/${positional[0]}` : positional[0]).href : null
  if (detailURL && !new URL(detailURL).pathname.startsWith("/vacancy/")) throw new PortalError("detail requires a vacancy URL or ID", "BAD_URL")
  const robots = await fetchPage("/robots.txt", undefined, fetcher)
  if (!robots) throw new PortalError("robots.txt unavailable", "ROBOTS_DENIED")
  let output: unknown
  let rows: Record<string, unknown>[] = []
  if (command === "detail") {
    const html = await fetchPage(detailURL!, robots, fetcher)
    output = html === null ? null : parseDetail(html, detailURL!)
    rows = output ? [output as Record<string, unknown>] : []
  } else {
    const map = await fetchPage("/llms.txt", robots, fetcher)
    const catalog = professions(map ?? "")
    if (!catalog.length) throw new PortalError("Public profession catalog unavailable", "PARSE_ERROR")
    if (command === "professions") { output = catalog; rows = catalog }
    else {
      const code = resolveProfession(flags.query, catalog)
      const url = `${ORIGIN}/vacancy-list/${code}`
      const html = await fetchPage(url, robots, fetcher)
      if (html === null) throw new PortalError("Category unavailable; coverage unknown", "NOT_FOUND")
      const results = parseSearch(html).slice(0, limit)
      rows = results as unknown as Record<string, unknown>[]
      output = { meta: { count: results.length, page: 1, total: null, partial: true,
        source_url: url, coverage: "Public SSR sample only; not all matching vacancies. date is unknown; seen_at is first appearance on HireSeeker." }, results }
    }
  }
  output = stripInvisible(output)
  if (format === "json") console.log(JSON.stringify(output))
  else if (format === "table") console.log(rows.map(row => command === "professions" ? [row.code, row.name].join("\t") :
    [row.id, row.title, row.company ?? "?", row.location ?? "?", row.date ?? "?", row.url].join("\t")).join("\n"))
  else console.log(rows.map(row => Object.entries(row).map(([k, v]) => `${k}: ${v ?? "unspecified"}`).join("\n")).join("\n\n") || "null")
  if (command === "search" && format !== "json") console.error(JSON.stringify({ warning: "Public category sample only; incomplete coverage; dates/locations unknown. See detail and WebSearch.", code: "PARTIAL_COVERAGE" }))
}
if (import.meta.main) {
  main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ error: stripInvisible(error instanceof PortalError ? error.message : "Unexpected portal failure"),
      code: error instanceof PortalError ? error.code : "INTERNAL_ERROR" }))
    process.exitCode = 1
  })
}
