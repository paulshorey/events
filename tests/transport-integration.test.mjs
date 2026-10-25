import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../src/storage/journal.mjs";
import { work, optionsFor } from "../src/worker.mjs";
import { registry } from "../src/registry.mjs";
import { Transport } from "../src/runtime/transport.mjs";

for (const kind of ["api", "listing"]) {
  test(`${kind} robots throttling persists the publisher cooldown across clients`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "events-robots-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let robotsHits = 0, contentHits = 0;
    const server = createServer((req, res) => {
      if (req.url === "/robots.txt") {
        robotsHits++;
        if (robotsHits === 1) {
          res.writeHead(429, { "Retry-After": "120" });
          return res.end("try later");
        }
        return res.end("User-agent: *\nAllow: /");
      }
      contentHits++;
      res.setHeader("content-type", "text/html");
      res.end("<html><body>Allowed after cooldown</body></html>");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/events`;
    const db = join(dir, "journal.sqlite");
    let now = Date.now();
    let journal = new Journal(db, () => now);
    const run = { id: "robots", attemptId: "one", source_key: "publisher", config: { url, timeZone: "UTC", minIntervalMs: 1 } };
    const first = new Transport({ root: dir, run, journal });
    await assert.rejects(first.fetch({ id: "one", url, kind }), { code: "rate_limited", retryAfterMs: 120000 });
    await first.close();
    journal.close();
    // A distinct collection/client for the same publisher must use the persisted delay.
    journal = new Journal(db, () => now);
    t.after(() => journal.close());
    const next = new Transport({ root: dir, run: { ...run, id: "other-collection" }, journal });
    t.after(() => next.close());
    await assert.rejects(next.fetch({ id: "two", url, kind }), { code: "rate_limited", retryAfterMs: 120000 });
    assert.equal(robotsHits, 1);
    assert.equal(contentHits, 0);
    now += 120001;
    const result = await next.fetch({ id: "three", url, kind });
    assert.match(result.body, /Allowed after cooldown/);
    assert.equal(robotsHits, 2);
    assert.equal(contentHits, 1);
  });
}

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

for (const kind of ["api", "listing"]) {
  test(`${kind} redirect to an unrelated host retains evidence and fails collection scope`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "events-redirect-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const server = createServer((req, res) => {
      if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /");
      if (req.url === "/start") {
        res.writeHead(302, {
          location: `http://localhost:${server.address().port}/unrelated`,
        });
        return res.end();
      }
      res.end("Unrelated publisher, never accept as the original collection");
    });
    await new Promise((resolve) => server.listen(0, resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/start`;
    const transport = new Transport({
      root: dir,
      run: {
        id: "test",
        attemptId: "one",
        source_key: "127.0.0.1",
        config: { url, timeZone: "UTC" },
      },
      journal: { reserveRate: () => 0 },
    });
    t.after(() => transport.close());
    await assert.rejects(transport.fetch({ id: "one", url, kind }), asyncError);
    function asyncError(error) {
      assert.equal(error.code, "scope_violation");
      assert.ok(
        error.capture?.path,
        "retain redirected response as failure evidence",
      );
      return true;
    }
  });
}

test("navigation during final policy validation cannot change the captured page's base URL", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-navigation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /");
    res.setHeader("content-type", "text/html");
    res.end(
      req.url === "/original"
        ? '<!DOCTYPE html><html><body id="original"><a href="./event">Original event listing</a></body></html>'
        : "<!DOCTYPE html><html><body>Unrelated page after navigation</body></html>",
    );
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/original`;
  const transport = new Transport({
    root: dir,
    run: {
      id: "navigation",
      attemptId: "one",
      source_key: "127.0.0.1",
      config: { url, timeZone: "UTC", readySelector: "#original" },
    },
    journal: { reserveRate: () => 0 },
  });
  t.after(() => transport.close());
  const permit = transport.permit.bind(transport);
  let checks = 0,
    navigated = false;
  transport.permit = async (checkedUrl) => {
    await permit(checkedUrl);
    // Force the race while the final asynchronous policy check is in flight.
    if (++checks === 3) {
      await transport.context
        .pages()[0]
        .goto(`http://localhost:${server.address().port}/other`, {
          waitUntil: "domcontentloaded",
        });
      navigated = true;
    }
  };
  const result = await transport.fetch({ id: "one", url, kind: "listing" });
  assert.equal(navigated, true, "exercise navigation during final permit");
  assert.equal(
    result.url,
    url,
    "return the URL checked for this captured document",
  );
  assert.equal(result.capture.url, url);
  assert.match(result.body, /Original event listing/);
  assert.doesNotMatch(result.body, /Unrelated page after navigation/);
  assert.equal(await readFile(result.capture.path, "utf8"), result.body);
  assert.equal(new URL("./event", result.url).hostname, "127.0.0.1");
});
