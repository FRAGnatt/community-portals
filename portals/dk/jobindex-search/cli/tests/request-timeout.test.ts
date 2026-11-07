import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { apiFetch, htmlFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert both request
// wrappers pass fetch the signal from AbortSignal.timeout(15000).
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("request timeout", () => {
  test("apiFetch passes an AbortSignal timeout to fetch", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await apiFetch("/search");
      expect(timeout).toHaveBeenCalledWith(15000);
      expect(init?.signal).toBe(timeout.mock.results[0].value as AbortSignal);
    } finally {
      timeout.mockRestore();
    }
  });

  test("htmlFetch passes an AbortSignal timeout to fetch", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await htmlFetch("https://www.jobindex.dk/x");
      expect(timeout).toHaveBeenCalledWith(15000);
      expect(init?.signal).toBe(timeout.mock.results[0].value as AbortSignal);
    } finally {
      timeout.mockRestore();
    }
  });
});
