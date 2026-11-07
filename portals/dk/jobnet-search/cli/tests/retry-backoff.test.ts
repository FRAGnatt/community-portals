import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// records each requested delay but fires immediately, so the exhaustion case
// checks the 500ms -> 5s backoff schedule without sleeping through it.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers(): number[] {
  const delays: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms = 0) => {
    delays.push(ms);
    return originalSetTimeout(fn, 0);
  }) as unknown as typeof setTimeout;
  return delays;
}

// Each retry waits the doubling base delay (capped at 5s) plus 0-500ms jitter.
function expectBackoff(delays: number[], bases: number[]) {
  expect(delays).toHaveLength(bases.length);
  delays.forEach((ms, i) => {
    expect(ms).toBeGreaterThanOrEqual(bases[i]);
    expect(ms).toBeLessThan(bases[i] + 500);
  });
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("apiFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    const delays = instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"ok":true}', { status: 200 }),
    ]);

    const data = await apiFetch<{ ok: boolean }>("/x");
    expect(data.ok).toBe(true);
    expect(state.calls).toBe(2);
    expectBackoff(delays, [500]);
  });

  test("does not retry a plain 4xx", async () => {
    const state = stubFetch([() => new Response("", { status: 400 })]);

    await expect(apiFetch("/x")).rejects.toThrow(/400/);
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    const delays = instantTimers();
    const state = stubFetch([() => new Response("", { status: 500 })]);

    await expect(apiFetch("/x")).rejects.toThrow(/500/);
    expect(state.calls).toBe(7);
    expectBackoff(delays, [500, 1000, 2000, 4000, 5000, 5000]);
  });
});
