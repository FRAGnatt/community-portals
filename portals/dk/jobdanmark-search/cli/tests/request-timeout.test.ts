import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { apiFetch, apiPost, htmlFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert every request
// wrapper hands fetch the signal from AbortSignal.timeout(15000), not just any signal.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const wrappers: Array<[string, () => Promise<unknown>, string]> = [
  ["apiFetch", () => apiFetch("/search"), "{}"],
  ["htmlFetch", () => htmlFetch("https://jobdanmark.dk/job/x"), "<html></html>"],
  ["apiPost", () => apiPost("/search", { q: "x" }), "{}"],
];

describe("request timeout", () => {
  for (const [name, call, body] of wrappers) {
    test(`${name} passes a 15s AbortSignal.timeout to fetch`, async () => {
      const timeout = spyOn(AbortSignal, "timeout");
      let init: RequestInit | undefined;
      globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
        init = i;
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch;

      try {
        await call();
        expect(timeout).toHaveBeenCalledWith(15000);
        expect(timeout.mock.results[0].value).toBe(init?.signal);
      } finally {
        timeout.mockRestore();
      }
    });
  }
});
