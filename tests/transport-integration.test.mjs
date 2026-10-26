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
    let robotsHits = 0,
      contentHits = 0;
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
    const run = {
      id: "robots",
      attemptId: "one",
      source_key: "publisher",
      config: { url, timeZone: "UTC", minIntervalMs: 1 },
    };
    const first = new Transport({ root: dir, run, journal });
    await assert.rejects(first.fetch({ id: "one", url, kind }), {
      code: "rate_limited",
      retryAfterMs: 120000,
    });
    await first.close();
    journal.close();
    // A distinct collection/client for the same publisher must use the persisted delay.
    journal = new Journal(db, () => now);
    t.after(() => journal.close());
    const next = new Transport({
      root: dir,
      run: { ...run, id: "other-collection" },
      journal,
    });
    t.after(() => next.close());
    await assert.rejects(next.fetch({ id: "two", url, kind }), {
      code: "rate_limited",
      retryAfterMs: 120000,
    });
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

for (const budget of [4, 5]) {
  test(`browser recovery accounts for every click and respects request budget ${budget}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "events-browser-recovery-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const contentTimes = [];
    const html = `<div class="Card_card__fixture"><a class="ContentCard_headerLink" href="/events/1/">Dance 1</a><div class="ContentCard_tagContainer">Oct 25, 2026</div></div>
      <ul class="SearchPagination_pagination"><li class="SearchPagination_active">1</li><li class="next"><a onclick="const n=Number(document.querySelector('.SearchPagination_active').textContent)+1;fetch('/page/'+n).then(()=>{document.querySelector('.SearchPagination_active').textContent=n;document.querySelector('.ContentCard_headerLink').textContent='Dance '+n;document.querySelector('.ContentCard_headerLink').href='/events/'+n+'/';if(n===3)document.querySelector('li.next').classList.add('disabled')})">Next</a></li></ul>`;
    const server = createServer((req, res) => {
      if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /");
      if (req.url === "/favicon.ico") return res.end();
      contentTimes.push(Date.now());
      res.setHeader("content-type", "text/html");
      res.end(req.url.startsWith("/page/") ? "ok" : html);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/events/`;
    const config = {
      ...(await registry()).find((c) => c.id === "url-024"),
      url,
      allowedHosts: ["127.0.0.1"],
      sourceKey: "fixture",
      rateKey: "fixture",
      maxDepth: 0,
      minIntervalMs: 150,
      quality: null,
    };
    const j = new Journal(join(dir, "journal.sqlite"));
    t.after(() => j.close());
    j.register([config]);
    const q = j.enqueue(
      config.id,
      optionsFor(config, { asOf: "2026-10-16", maxPages: 2 }, "test-build"),
    );
    let out = await work(j, { root: dir, build: "test-build", runId: q.runId });
    assert.equal(out[0].status, "partial");
    assert.equal(j.run(q.runId).requests, 2);
    assert.equal(j.records(q.runId).length, 2);
    j.resume(q.runId, { maxPages: budget });
    // A fresh worker/browser must reconstruct pages 1 and 2 to reach pending page 3.
    contentTimes.length = 0;
    const reserveRate = j.reserveRate.bind(j);
    let reservations = 0;
    j.reserveRate = (...args) => {
      reservations++;
      return reserveRate(...args);
    };
    out = await work(j, { root: dir, build: "test-build", runId: q.runId });
    const expected = budget - 2;
    assert.equal(reservations, expected);
    assert.equal(contentTimes.length, expected);
    for (let i = 1; i < contentTimes.length; i++)
      assert.ok(
        contentTimes[i] - contentTimes[i - 1] >= 100,
        "each recovery click must observe publisher pacing",
      );
    assert.equal(j.run(q.runId).requests, budget);
    assert.equal(out[0].status, budget === 4 ? "partial" : "complete");
    assert.equal(j.records(q.runId).length, budget === 4 ? 2 : 3);
    if (budget === 4) {
      assert.equal(out[0].stopReason, "request_budget");
      assert.equal(
        j.pages(q.runId).filter((p) => p.state === "pending").length,
        1,
      );
      assert.equal(
        j.pages(q.runId).filter((p) => p.state === "failed").length,
        0,
      );
    }
  });
}

test("browser recovery stops at the runtime boundary and preserves its pending target", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-browser-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  let offset = 0,
    expireRecovery = false;
  const actualNow = Date.now.bind(Date);
  t.mock.method(Date, "now", () => actualNow() + offset);
  const html = `<div class="Card_card__fixture"><a class="ContentCard_headerLink" href="/events/1/">Dance 1</a><div class="ContentCard_tagContainer">Oct 25, 2026</div></div>
    <ul class="SearchPagination_pagination"><li class="SearchPagination_active">1</li><li class="next"><a onclick="const n=Number(document.querySelector('.SearchPagination_active').textContent)+1;fetch('/page/'+n).then(()=>{document.querySelector('.SearchPagination_active').textContent=n;document.querySelector('.ContentCard_headerLink').textContent='Dance '+n;document.querySelector('.ContentCard_headerLink').href='/events/'+n+'/';if(n===3)document.querySelector('li.next').classList.add('disabled')})">Next</a></li></ul>`;
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
    if (req.url === "/favicon.ico") return res.end();
    requests.push(req.url);
    // Advance only the worker/journal clock, after a real intermediate click.
    // This crosses the 10-second runtime budget while retaining the 60-second lease.
    if (expireRecovery && req.url === "/page/2") offset += 10001;
    res.setHeader("content-type", "text/html");
    res.end(req.url.startsWith("/page/") ? "ok" : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/events/`;
  const config = {
    ...(await registry()).find((c) => c.id === "url-024"),
    url,
    allowedHosts: ["127.0.0.1"],
    sourceKey: "fixture",
    rateKey: "fixture",
    maxDepth: 0,
    minIntervalMs: 150,
    quality: null,
  };
  const j = new Journal(join(dir, "journal.sqlite"));
  t.after(() => j.close());
  j.register([config]);
  const q = j.enqueue(
    config.id,
    optionsFor(
      config,
      { asOf: "2026-10-16", maxPages: 2, maxRuntimeMs: 10000 },
      "test-build",
    ),
  );
  await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.equal(j.records(q.runId).length, 2);
  const prior = j.records(q.runId);
  j.resume(q.runId, {
    maxPages: 20,
    maxRuntimeMs: j.run(q.runId).active_ms + 10000,
  });
  requests.length = 0;
  expireRecovery = true;
  const out = await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.equal(out[0].status, "partial");
  assert.equal(out[0].stopReason, "runtime_budget");
  assert.deepEqual(requests, ["/events/", "/page/2"]);
  assert.deepEqual(j.records(q.runId), prior);
  assert.equal(j.pages(q.runId).filter((p) => p.state === "pending").length, 1);
  assert.equal(j.pages(q.runId).filter((p) => p.state === "failed").length, 0);
  // An explicit cumulative budget extension can finish without losing prior output.
  expireRecovery = false;
  j.resume(q.runId, { maxRuntimeMs: j.run(q.runId).active_ms + 10000 });
  const resumed = await work(j, {
    root: dir,
    build: "test-build",
    runId: q.runId,
  });
  assert.equal(resumed[0].status, "complete");
  assert.equal(j.records(q.runId).length, 3);
});

test("ordinary API task may finish after its pacing wait crosses the runtime boundary", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-api-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = JSON.parse(
    await readFile(new URL("fixtures/tribe-page.json", import.meta.url)),
  );
  let contentHits = 0,
    offset = 0;
  const actualNow = Date.now.bind(Date);
  t.mock.method(Date, "now", () => actualNow() + offset);
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
    contentHits++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ...fixture,
        total: 1,
        total_pages: 1,
        events: [fixture.events[0]],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = {
    ...(await registry()).find((c) => c.id === "url-019"),
    url: base + "/calendar",
    apiEndpoint: base + "/api/events",
    allowedHosts: ["127.0.0.1"],
    sourceKey: "fixture",
    rateKey: "fixture",
    quality: null,
  };
  const j = new Journal(join(dir, "journal.sqlite"));
  t.after(() => j.close());
  j.register([config]);
  const q = j.enqueue(
    config.id,
    optionsFor(
      config,
      { asOf: "2026-10-16", transport: "api", maxRuntimeMs: 10000 },
      "test-build",
    ),
  );
  const reserve = j.reserveRate.bind(j);
  j.reserveRate = (...args) => {
    reserve(...args);
    // The task was admitted within budget; its ordinary pacing crosses the deadline.
    offset = 10001;
    return 150;
  };
  const out = await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.equal(contentHits, 1);
  assert.equal(out[0].status, "complete");
  assert.equal(j.records(q.runId).length, 1);
  assert.ok(j.run(q.runId).active_ms > 10000);
});

test("ordinary NYC task finishes when pacing crosses the runtime boundary", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-nyc-task-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  let offset = 0;
  const actualNow = Date.now.bind(Date);
  t.mock.method(Date, "now", () => actualNow() + offset);
  const html = `<div class="Card_card__fixture"><a class="ContentCard_headerLink" href="/events/1/">Dance 1</a><div class="ContentCard_tagContainer">Oct 25, 2026</div></div>
    <ul class="SearchPagination_pagination"><li class="SearchPagination_active">1</li><li class="next"><a onclick="fetch('/page/2').then(()=>{document.querySelector('.SearchPagination_active').textContent=2;document.querySelector('.ContentCard_headerLink').textContent='Dance 2';document.querySelector('.ContentCard_headerLink').href='/events/2/';document.querySelector('li.next').classList.add('disabled')})">Next</a></li></ul>`;
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
    if (req.url === "/favicon.ico") return res.end();
    requests.push(req.url);
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/page/2" ? "ok" : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = {
    ...(await registry()).find((c) => c.id === "url-024"),
    url: `http://127.0.0.1:${server.address().port}/events/`,
    allowedHosts: ["127.0.0.1"],
    sourceKey: "fixture",
    rateKey: "fixture",
    maxDepth: 0,
    minIntervalMs: 150,
    quality: null,
  };
  const j = new Journal(join(dir, "journal.sqlite"));
  t.after(() => j.close());
  j.register([config]);
  const q = j.enqueue(
    config.id,
    optionsFor(config, { asOf: "2026-10-16", maxRuntimeMs: 10000 }, "test-build"),
  );
  const reserve = j.reserveRate.bind(j);
  let pacingCalls = 0;
  j.reserveRate = (...args) => {
    const delay = reserve(...args);
    // The second task was admitted within budget and reuses the live page.
    if (++pacingCalls === 2) {
      offset += 10001;
      return 150;
    }
    return delay;
  };
  const out = await work(j, { root: dir, build: "test-build", runId: q.runId });
  assert.deepEqual(requests, ["/events/", "/page/2"]);
  assert.equal(out[0].status, "complete");
  assert.equal(j.records(q.runId).length, 2);
  assert.equal(j.pages(q.runId).filter((p) => p.state === "pending").length, 0);
  assert.ok(j.run(q.runId).active_ms > 10000);
});
