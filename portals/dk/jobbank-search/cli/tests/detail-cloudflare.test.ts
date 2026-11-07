import { afterEach, describe, expect, test } from "bun:test"
import { detail } from "../src/commands/detail"

const originalFetch = globalThis.fetch
const originalWrite = process.stderr.write
const originalExit = process.exit

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stderr.write = originalWrite
  process.exit = originalExit
})

describe("detail", () => {
  test("reports a Cloudflare 403 challenge with the WebSearch-fallback message", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        statusText: "Forbidden",
      })) as unknown as typeof fetch
    const stderr: string[] = []
    process.stderr.write = ((chunk: string) => stderr.push(chunk)) as unknown as typeof process.stderr.write
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as unknown as typeof process.exit

    const handler = (detail as unknown as { handler: (ctx: unknown) => Promise<void> }).handler
    await expect(
      handler({ flags: { format: "json" }, positional: ["123456"], signal: new AbortController().signal }),
    ).rejects.toThrow("process.exit(1)")
    expect(JSON.parse(stderr.join(""))).toEqual({
      error: "Jobbank is blocking automated requests with Cloudflare bot protection. Skip this portal or use the WebSearch fallback.",
      code: "API_ERROR",
    })
  })
})
