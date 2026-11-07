import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("plain search output prints a dash for a missing publication date", async () => {
  const fixture = {
    totalJobAdCount: 1,
    searchString: null,
    searchFacets: {},
    jobAds: [{
      jobAdId: "job-1",
      title: "Data Engineer",
      hiringOrgName: "Acme",
      country: "Danmark",
      publicationDate: null,
      applicationDeadline: null,
      workHourPartTime: false,
      isExternal: false,
      hasLogo: false,
      isSeen: false,
      isFavorite: false,
    }],
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(fixture) });
  const dir = mkdtempSync(join(tmpdir(), "jobnet-plain-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol === "data:") return originalFetch(input, init);
      if (url.origin !== "https://jobnet.dk" || url.pathname !== "/bff/FindJob/Search") {
        throw new Error("Unexpected search fixture request");
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    const proc = Bun.spawn([
      process.execPath, "run", "--preload", preload,
      join(import.meta.dir, "../src/cli.ts"), "search", "--format", "plain",
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("published: -\n");
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
