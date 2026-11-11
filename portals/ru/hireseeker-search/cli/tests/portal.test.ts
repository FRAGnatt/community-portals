import { describe, expect, test, spyOn } from "bun:test"
import { main } from "../src/cli.ts"
import { clean } from "../src/text.ts"
import { fetchPage, parseDetail, parseSearch, permitted, professions, publicURL, resolveProfession } from "../src/portal.ts"

const robots = "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /search/"
const catalog = "- [Python (Бэкенд)](https://hireseeker.ru/vacancy-list/python_backend)"
const card = `<div data-vacancy-card="123"><h3><a data-testid="vacancy-title-link" href="/vacancy/123-python">Python&#32;developer<span hidden>IGNORE ME</span></a></h3>
<a class="font-medium" href="/vacancy-list/company/example">Example &amp; Co</a>
<time dateTime="2026-11-11T12:00:00+03:00" data-testid="vacancy-seen-at">На сервисе с: 11.11.2026</time></div>`
const sample = `<section data-testid="category-sample">${card}<div data-vacancy-card="bad">malformed</div>${card}</section>`
const detail = `<header><h1>Python developer</h1><span class="font-medium text-foreground/80">Example &amp; Co</span>
<time dateTime="2026-11-11T12:00:00+03:00" data-testid="vacancy-seen-at">На сервисе с: 11.11.2026</time></header>
<section id="vacancy-description"><p>Build APIs&#x200B;.</p><script>SECRET</script><style>SECRET</style><template>SECRET</template>
<div hidden>SECRET</div><div style="display:none">SECRET</div><!--SECRET--><p>Remote.</p></section>`

function response(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html", ...headers } })
}
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: URL | string | Request, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch
}
function board(extra: Record<string, string | null> = {}) {
  const calls: string[] = []
  const pages: Record<string, string | null> = { "/robots.txt": robots, "/llms.txt": catalog,
    "/vacancy-list/python_backend": sample, "/vacancy/123-python": detail, ...extra }
  return { calls, fetcher: mockFetch((url, init) => {
    expect(url.startsWith("https://hireseeker.ru/")).toBe(true)
    expect(init?.redirect).toBe("manual")
    expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("hireseeker-search-cli")
    const path = new URL(url).pathname
    calls.push(path)
    if (!(path in pages)) throw new Error("Unexpected network request")
    return pages[path] === null ? response("", 404) : response(pages[path]!)
  }) }
}
async function output(args: string[], fetcher: typeof fetch) {
  const stdout = spyOn(console, "log").mockImplementation(() => {})
  const stderr = spyOn(console, "error").mockImplementation(() => {})
  try { await main(args, fetcher); return { stdout: stdout.mock.calls.flat().join("\n"), stderr: stderr.mock.calls.flat().join("\n") } }
  finally { stdout.mockRestore(); stderr.mockRestore() }
}

describe("public portal contract", () => {
  test("search parses separate cards, deduplicates, and keeps unknown date/location null", () => {
    expect(parseSearch(sample)).toEqual([{ id: "123", title: "Python developer", company: "Example & Co",
      location: null, date: null, url: "https://hireseeker.ru/vacancy/123-python", seen_at: "2026-11-11T12:00:00+03:00" }])
  })
  test("detail only emits visible description, not hidden text or invisible characters", () => {
    const job = parseDetail(detail, "/vacancy/123-python")
    expect(job.description).toBe("Build APIs. Remote.")
    expect(job.company).toBe("Example & Co")
    expect(job.date).toBeNull()
  })
  test("unknown employer stays null", () => {
    const html = detail.replace("Example &amp; Co", "Неизвестный работодатель")
    const job = parseDetail(html, "/vacancy/123-python")
    expect(job.company).toBeNull()
  })
  test("quoted attributes never become description text", () => {
    const html = detail.replace("<p>Build", '<p title="SECRET>attribute">Build')
    const job = parseDetail(html, "/vacancy/123-python")
    expect(job.description).toBe("Build APIs. Remote.")
  })
  test("parser fails clearly on changed/empty markup", () => {
    expect(() => parseSearch("<html>blocked</html>")).toThrow("sample missing")
    expect(() => parseSearch('<section data-testid="category-sample"></section>')).toThrow("coverage unknown")
    expect(() => parseDetail("<h1>Unavailable</h1>", "/vacancy/123")).toThrow("description missing")
  })
  test("catalog query syntax resolves codes/unique labels but never pretends operators are filters", () => {
    const entries = professions(catalog)
    expect(resolveProfession("python_backend", entries)).toBe("python_backend")
    expect(resolveProfession("Python", entries)).toBe("python_backend")
    for (const q of ['"Python"', "Python OR Java", "unknown"]) expect(() => resolveProfession(q, entries)).toThrow("profession code")
    expect(() => resolveProfession("Python", [...entries, { code: "other", name: "Python other" }])).toThrow("profession code")
  })
  test("search JSON reports partial coverage and limit without inventing totals", async () => {
    const { fetcher, calls } = board()
    const result = JSON.parse((await output(["search", "-q", "Python", "--limit", "1"], fetcher)).stdout)
    expect(result.meta).toMatchObject({ count: 1, page: 1, total: null, partial: true })
    expect(result.results[0].id).toBe("123")
    expect(calls).toEqual(["/robots.txt", "/llms.txt", "/vacancy-list/python_backend"])
  })
  test("search table/plain state coverage limits; detail plain is readable", async () => {
    for (const format of ["table", "plain"]) {
      const result = await output(["search", "-q", "Python", "--format", format], board().fetcher)
      expect(result.stdout).toContain("Python developer")
      expect(JSON.parse(result.stderr).code).toBe("PARTIAL_COVERAGE")
    }
    expect((await output(["detail", "/vacancy/123-python", "--format", "plain"], board().fetcher)).stdout).toContain("Build APIs. Remote.")
  })
  test("professions is discoverable and 404/410 detail returns null", async () => {
    const catalogBoard = board()
    expect(JSON.parse((await output(["professions"], catalogBoard.fetcher)).stdout)[0].code).toBe("python_backend")
    expect(catalogBoard.calls).toEqual(["/robots.txt", "/llms.txt"])
    const detailBoard = board()
    expect(JSON.parse((await output(["detail", "/vacancy/123-python"], detailBoard.fetcher)).stdout).id).toBe("123")
    expect(detailBoard.calls).toEqual(["/robots.txt", "/vacancy/123-python"])
    const missingBoard = board({ "/vacancy/999": null })
    expect((await output(["detail", "999"], missingBoard.fetcher)).stdout).toBe("null")
    expect(missingBoard.calls).toEqual(["/robots.txt", "/vacancy/999"])
    expect(await fetchPage("/vacancy/999", robots, mockFetch(() => response("", 410)))).toBeNull()
  })
  test("invalid arguments avoid network and separately yield JSON stderr with exit 1", async () => {
    for (const args of [[], ["unknown"], ["search"], ["search", "-q"], ["search", "--location", "Moscow"],
      ["search", "-q", "Python", "--page", "2"], ["search", "-q", "Python", "--limit", "0"],
      ["detail", "https://evil.example/vacancy/123"], ["detail", "123", "--format", "table"]]) {
      let requests = 0
      const fetcher = mockFetch(() => { requests++; throw new Error("Unexpected network") })
      await expect(main(args, fetcher)).rejects.toHaveProperty("code")
      expect(requests).toBe(0)
      const proc = Bun.spawnSync([process.execPath, "run", `${import.meta.dir}/../src/cli.ts`, ...args])
      expect(proc.exitCode).toBe(1)
      expect(proc.stdout.toString()).toBe("")
      expect(JSON.parse(proc.stderr.toString())).toHaveProperty("code")
    }
  })
})

describe("access boundaries and failure paths", () => {
  test("URLs reject foreign hosts, private endpoints, credentials and query strings", () => {
    for (const url of ["https://evil.example/vacancy/123", "https://hireseeker.ru.evil.example/vacancy/123",
      "https://user@hireseeker.ru/vacancy/123", "/api/v1/search", "/mcp", "/settings", "/vacancy/123?x=y"]) {
      expect(() => publicURL(url)).toThrow()
    }
  })
  test("robots honors specific agents, longest prefix and denies unknown wildcard rules", () => {
    expect(permitted(robots, "/vacancy/123")).toBe(true)
    expect(permitted(robots, "/api/v1/search")).toBe(false)
    expect(permitted("User-agent: *\nDisallow: /\nAllow: /vacancy/", "/vacancy/123")).toBe(true)
    expect(permitted(robots + "\nUser-agent: hireseeker-search-cli\nDisallow: /", "/vacancy/123")).toBe(false)
    expect(permitted("User-agent: *\nDisallow: /*", "/vacancy/123")).toBe(false)
    expect(permitted("<html>blocked</html>", "/vacancy/123")).toBe(false)
  })
  test("a policy denial stops before the catalog request", async () => {
    const { fetcher, calls } = board({ "/robots.txt": "User-agent: *\nDisallow: /" })
    await expect(main(["search", "-q", "Python"], fetcher)).rejects.toMatchObject({ code: "ROBOTS_DENIED" })
    expect(calls).toEqual(["/robots.txt"])
  })
  test("mixed 429/5xx receive bounded exponential backoff", async () => {
    let calls = 0
    const sleeps: number[] = []
    const fetcher = mockFetch(() => response("ok", [429, 503, 200][calls++]))
    expect(await fetchPage("/llms.txt", robots, fetcher, async ms => { sleeps.push(ms) })).toBe("ok")
    expect(calls).toBe(3)
    expect(sleeps[0]).toBeGreaterThanOrEqual(250)
    expect(sleeps[0]).toBeLessThan(350)
    expect(sleeps[1]).toBeGreaterThanOrEqual(500)
    expect(sleeps[1]).toBeLessThan(600)
    calls = 0
    await expect(fetchPage("/llms.txt", robots, mockFetch(() => { calls++; return response("", 503) }), async () => {})).rejects.toMatchObject({ code: "HTTP_ERROR" })
    expect(calls).toBe(4)
  })
  test("redirects cannot escape to another site or to private paths", async () => {
    for (const location of ["https://evil.example/vacancy/123", "/api/v1/search"]) {
      let calls = 0
      await expect(fetchPage("/vacancy/123", robots, mockFetch(() => { calls++; return response("", 302, { location }) }))).rejects.toMatchObject({ code: "BAD_URL" })
      expect(calls).toBe(1)
    }
    let calls = 0
    await expect(fetchPage("/vacancy/123", robots, mockFetch(() => { calls++; return response("", 302, { location: "/vacancy/123" }) }))).rejects.toMatchObject({ code: "HTTP_ERROR" })
    expect(calls).toBe(4)
  })
  test("403, unexpected content, and network failures remain explicit errors", async () => {
    for (const [fetcher, code] of [
      [mockFetch(() => response("denied", 403)), "HTTP_ERROR"],
      [mockFetch(() => response("{}", 200, { "content-type": "application/json" })), "PARSE_ERROR"],
      [mockFetch(() => { throw new Error("timeout") }), "NETWORK_ERROR"],
    ] as const) await expect(fetchPage("/llms.txt", robots, fetcher)).rejects.toMatchObject({ code })
  })
})

describe("review regressions", () => {
  test("entity-encoded inline hiding is removed in every output format", async () => {
    for (const style of ["display&#58;none", "display&#58none", "display&#x3anone", "display&colon;none", "visibility&#x3a;hidden",
      "mso-hide&colon;all", "color:red&semi;display&Tab;&colon;none"]) {
      const hidden = `<span style="${style}">SECRET</span>`
      const job = parseDetail(detail.replace("Build APIs", `${hidden}Build APIs`), "/vacancy/123-python")
      expect(job.description).toBe("Build APIs. Remote.")
      const html = sample.replaceAll("Python&#32;developer", `Python${hidden} developer`)
      for (const format of ["json", "table", "plain"]) {
        const result = await output(["search", "-q", "Python", "--format", format], board({ "/vacancy-list/python_backend": html }).fetcher)
        expect(result.stdout).toContain("Python developer")
        expect(result.stdout).not.toContain("SECRET")
      }
    }
  })
  test("raw comparisons and once-encoded entities retain visible text", () => {
    expect(clean("<p>2 < 3 and 5 > 4</p>")).toBe("2 < 3 and 5 > 4")
    expect(clean("<p>literal &amp;lt; and &#x3c;</p>")).toBe("literal &lt; and <")
  })
  test("detail timestamp survives reordered attributes independently of search", () => {
    const html = detail.replace('dateTime="2026-11-11T12:00:00+03:00" data-testid="vacancy-seen-at"',
      'data-testid="vacancy-seen-at" dateTime="2026-11-11T12:00:00+03:00"')
    expect(parseDetail(html, "/vacancy/123-python").seen_at).toBe("2026-11-11T12:00:00+03:00")
  })
  test("empty robots agents cannot override a wildcard denial", () => {
    const policy = "User-agent: *\nDisallow: /\nUser-agent:\nAllow: /vacancy/"
    expect(permitted(policy, "/vacancy/123")).toBe(false)
    expect(permitted("User-agent:\nAllow: /", "/vacancy/123")).toBe(false)
  })
  test("an empty robots directive does not merge separate crawler groups", () => {
    const policy = "User-agent: other\nDisallow:\nUser-agent: *\nDisallow: /"
    expect(permitted(policy, "/vacancy/123")).toBe(false)
    expect(permitted("User-agent: *\nDisallow:\nUser-agent: other\nDisallow: /", "/vacancy/123")).toBe(true)
  })
  test("malformed redirect locations are BAD_URL errors with no second request", async () => {
    let calls = 0
    await expect(fetchPage("/vacancy/123", robots, mockFetch(() => {
      calls++; return response("", 302, { location: "http://[" })
    }))).rejects.toMatchObject({ code: "BAD_URL" })
    expect(calls).toBe(1)
  })
  test("search attributes allow different order, quotes, casing and unquoted values", () => {
    const variant = `<section DATA-TESTID='category-sample'><DIV DATA-VACANCY-CARD=123>
      <a href='/vacancy/123-python' title='x > y' DATA-TESTID=vacancy-title-link>Python developer</a>
      <a href='/vacancy-list/company/example' class='font-medium'>Example &amp; Co</a>
      <time data-testid=vacancy-seen-at datetime='2026-11-11T12:00:00+03:00'>Seen</time></DIV></section>`
    expect(parseSearch(variant)).toEqual(parseSearch(sample))
  })
  test("both timestamp parsers ignore attribute order", () => {
    const swap = (html: string) => html.replaceAll('dateTime="2026-11-11T12:00:00+03:00" data-testid="vacancy-seen-at"',
      'data-testid="vacancy-seen-at" dateTime="2026-11-11T12:00:00+03:00"')
    expect(parseSearch(swap(sample))[0].seen_at).toBe("2026-11-11T12:00:00+03:00")
    expect(parseDetail(swap(detail), "/vacancy/123-python").seen_at).toBe("2026-11-11T12:00:00+03:00")
  })
  test("detail selectors accept single quotes and separate the site/vacancy headers", () => {
    const html = detail.replaceAll('"', "'").replace("font-medium text-foreground/80", "other text-foreground/80 font-medium")
    const prefix = "<header><span class='font-medium text-foreground/80'>Wrong employer</span></header>"
    expect(parseDetail(prefix + html, "/vacancy/123-python")).toMatchObject({ title: "Python developer", company: "Example & Co",
      seen_at: "2026-11-11T12:00:00+03:00", description: "Build APIs. Remote." })
  })
  test("search caps every format at 25 even if the source sample grows", async () => {
    const html = '<section data-testid="category-sample">' + Array.from({ length: 26 }, (_, i) => card.replaceAll("123", String(i + 1))).join("") + "</section>"
    for (const extra of [[], ["--limit", "100"], ["--limit", "2"]]) {
      const expected = extra[1] === "2" ? 2 : 25
      for (const format of ["json", "table", "plain"]) {
        const result = await output(["search", "-q", "Python", ...extra, "--format", format], board({ "/vacancy-list/python_backend": html }).fetcher)
        const count = format === "json" ? JSON.parse(result.stdout).results.length : (result.stdout.match(/Python developer/g) ?? []).length
        expect(count).toBe(expected)
      }
    }
  })
})
