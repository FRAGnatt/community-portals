import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. The stub fetch never
// answers on its own; only the request's signal aborting can end the call.
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
});

describe("apiFetch request timeout", () => {
  test("aborts a stalled request after 15 seconds", async () => {
    const requested: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      requested.push(ms);
      return originalTimeout.call(AbortSignal, 1);
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;

    await expect(apiFetch("/search")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requested).toEqual([15000]);
  });
});
