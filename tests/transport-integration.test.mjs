import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../src/storage/journal.mjs";
import { work, optionsFor } from "../src/worker.mjs";
import { registry } from "../src/registry.mjs";

// Real Playwright HTTP client, controlled upstream. No external service is hit by this test.
test("HTTP 429 retains an API checkpoint, honors Retry-After and resumes via a new client", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-http-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = JSON.parse(
    await readFile(new URL("fixtures/tribe-page.json", import.meta.url)),
  );
  let throttle = true,
    hits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200);
      res.end("User-agent: *\nAllow: /");
      return;
    }
    const page = Number(
      new URL(req.url, "http://localhost").searchParams.get("page"),
    );
    hits++;
    if (page === 2 && throttle) {
      throttle = false;
      res.writeHead(429, { "retry-after": "1" });
      res.end("try later");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ...fixture,
        total: 2,
        total_pages: 2,
        events: [{ ...fixture.events[0], id: page }],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`,
    c = {
      ...(await registry()).find((c) => c.id === "url-019"),
      url: base + "/calendar",
      apiEndpoint: base + "/api/events",
      allowedHosts: ["127.0.0.1"],
      rateKey: "127.0.0.1",
      sourceKey: "127.0.0.1",
    };
  let now = Date.now();
  const j = new Journal(join(dir, "journal.sqlite"), () => now);
  t.after(() => j.close());
  j.register([c]);
  const q = j.enqueue(
    c.id,
    optionsFor(c, { asOf: "2026-10-16", transport: "api" }, "test-build"),
  );
  let out = await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.equal(out[0].status, "retry_wait");
  assert.equal(j.records(q.runId).length, 1);
  assert.equal(j.run(q.runId).not_before, now + 1000);
  assert.equal(j.claim("too-early"), null);
  now += 2000;
  out = await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.equal(out[0].status, "complete");
  assert.equal(hits, 3);
  assert.equal(j.records(q.runId).length, 2);
  assert.equal(j.run(q.runId).requests, 3);
  assert.equal(j.pages(q.runId).length, 2);
});
