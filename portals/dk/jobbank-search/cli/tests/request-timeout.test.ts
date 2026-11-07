import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchWithUA } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchWithUA request timeout", () => {
  test("passes fetch a signal that times out after 15 seconds", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("<rss></rss>", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await fetchWithUA("https://jobbank.dk/job/rss");
      expect(timeout).toHaveBeenCalledWith(15000);
      expect(init?.signal).toBe(timeout.mock.results[0].value as AbortSignal);
    } finally {
      timeout.mockRestore();
    }
  });
});
