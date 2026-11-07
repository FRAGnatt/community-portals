import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { apiGet } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request
// wrapper carries a 15s AbortSignal.timeout, not just any signal.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("apiGet request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await apiGet("/jobs");
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(init?.signal).toBe(timeout.mock.results[0].value);
  });
});
