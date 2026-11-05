import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Journal, LeaseLost } from "../src/storage/journal.mjs";
import { work, optionsFor } from "../src/worker.mjs";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { robotsAllowed, retryDelay } from "../src/runtime/transport.mjs";
import { dates, jsonLdEvents, recordFromJsonLd } from "../src/records.mjs";

const configs = await registry(),
  la = configs.find((c) => c.id === "url-038");
const laHtml = await readFile(
  new URL("fixtures/la-calendar.html", import.meta.url),
  "utf8",
);
const tribe = JSON.parse(
  await readFile(new URL("fixtures/tribe-page.json", import.meta.url)),
);
const config = (id = "url-038", host = "laconventioncenter.com") => ({
  ...la,
  id,
  url: `https://${host}/events/all`,
  sourceKey: host,
  rateKey: host,
});
const options = (extra = {}) =>
  optionsFor(la, { asOf: "2026-10-16", ...extra }, "test-build");
const blank = {
  records: [],
  nextRequests: [],
  issues: [],
  terminal: true,
  coverage: "verified-list",
};
const capture = { path: "/saved/example.html", hash: "fixture" };
function setup(t, cs = [config()]) {
  let now = 1000000;
  const j = new Journal(":memory:", () => now);
  j.register(cs);
  t.after(() => j.close());
  return { j, advance: (n) => (now += n) };
}
function complete(j, id, records = 1) {
  const q = j.enqueue(id, options()),
    r = j.claim("test", 60000, q.runId);
  j.finish(r.id, r.token, "complete", {
    recordCount: records,
    observedRecords: records,
  });
  return r;
}

test("all 97 seed URLs have a validated registry entry and executable module", async () => {
  const seeds = JSON.parse(
    await readFile(new URL("../sources/seed-urls.json", import.meta.url)),
  );
  assert.equal(configs.length, 97);
  assert.equal(seeds.length, 97);
  assert.equal(configs.filter((c) => c.origin === "primary-list").length, 82);
  for (const c of configs) {
    assert.equal(c.enabled, false);
    assert.match(
      await readFile(new URL(`../${c.script}`, import.meta.url), "utf8"),
      new RegExp(`scraperMain\\('${c.id}'`),
    );
  }
});
test("enqueue coalesces active work; simultaneous connections cannot claim a host twice", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "journal.sqlite"),
    j = new Journal(file);
  t.after(() => j.close());
  j.register([config(), config("url-037")]);
  const first = j.enqueue("url-038", options());
  assert.equal(j.enqueue("url-038", options()).created, false);
  j.enqueue("url-037", options());
  assert.ok(j.claim("one", 60000, first.runId));
  const program = `import {Journal} from './src/storage/journal.mjs';const j=new Journal(process.argv[1]);console.log(JSON.stringify(j.claim('two')));j.close();`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program, file],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), null);
});
test("expired worker is recovered with its checkpoint and fenced out", (t) => {
  const { j, advance } = setup(t),
    q = j.enqueue("url-038", options()),
    old = j.claim("old", 1000, q.runId),
    p = j.nextPage(q.runId, old.token);
  advance(1001);
  assert.deepEqual(j.recover(), [q.runId]);
  assert.equal(j.pages(q.runId)[0].state, "pending");
  const fresh = j.claim("new", 1000, q.runId);
  assert.throws(
    () => j.commitPage(q.runId, old.token, p, blank, capture),
    LeaseLost,
  );
  assert.equal(j.run(q.runId).requests, 1);
  assert.equal(j.run(q.runId).active_ms, 1001);
  assert.notEqual(old.token, fresh.token);
});
test("checkpoint transaction rolls back observations when next-page insertion fails", (t) => {
  const { j } = setup(t),
    q = j.enqueue("url-038", options()),
    r = j.claim("x"),
    p = j.nextPage(q.runId, r.token);
  assert.throws(() =>
    j.commitPage(
      r.id,
      r.token,
      p,
      {
        ...blank,
        records: [{ sourceRecordId: "a" }],
        nextRequests: [{ url: null }],
      },
      capture,
    ),
  );
  assert.equal(j.records(r.id).length, 0);
  assert.equal(j.pages(r.id)[0].state, "processing");
  j.commitPage(
    r.id,
    r.token,
    p,
    {
      ...blank,
      records: [{ sourceRecordId: "a" }],
      nextRequests: [
        {
          url: "https://laconventioncenter.com/next",
          kind: "listing",
          meta: { pagination: true },
        },
      ],
    },
    capture,
  );
  assert.equal(j.records(r.id).length, 1);
  assert.equal(j.pages(r.id).length, 2);
});
test("cancellation invalidates an active worker without deleting previous data", (t) => {
  const { j } = setup(t),
    q = j.enqueue("url-038", options()),
    r = j.claim("x");
  j.cancel(r.id);
  assert.throws(() => j.heartbeat(r.id, r.token), LeaseLost);
  assert.equal(j.run(r.id).status, "cancelled");
  assert.equal(j.resume(r.id), r.id);
  assert.equal(j.run(r.id).status, "queued");
});
test("retry cooldown and hostname rate reservations persist", (t) => {
  const { j, advance } = setup(t),
    q = j.enqueue("url-038", options()),
    r = j.claim("x");
  assert.equal(j.reserveRate("host", 1000), 0);
  assert.equal(j.reserveRate("host", 1000), 1000);
  j.finish(
    r.id,
    r.token,
    "retry_wait",
    { recordCount: 0 },
    { code: "rate_limited", retryAfterMs: 5000 },
  );
  assert.equal(j.claim("early"), null);
  advance(5001);
  assert.ok(j.claim("later"));
});
test("schedule coalesces missed slots and skips repairs; init preserves enablement", (t) => {
  const { j, advance } = setup(t);
  assert.equal(j.schedule(options()).length, 0);
  j.configure("url-038", true);
  j.register([config()]);
  assert.equal(j.collection("url-038").enabled, 1);
  assert.equal(j.schedule(options()).length, 1);
  assert.equal(j.schedule(options()).length, 0);
  const r = j.claim("x");
  j.finish(
    r.id,
    r.token,
    "repair_needed",
    { recordCount: 0 },
    { code: "contract_changed" },
  );
  advance(20 * 86400000);
  assert.equal(j.schedule(options()).length, 0);
});
test("exact page-budget boundary can complete, and a probe never can", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-worker-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { j } = setup(t);
  const transportFactory = () => ({
    fetch: async () => ({ body: laHtml, url: la.url, capture }),
    close: async () => {},
  });
  const first = j.enqueue(la.id, options({ maxPages: 1 }));
  let result = await work(j, {
    root: dir,
    runId: first.runId,
    build: "test-build",
    transportFactory,
  });
  assert.equal(result[0].status, "complete");
  assert.equal(result[0].pendingPages, 0);
  const probe = j.enqueue(la.id, options({ maxPages: 1, probe: true }));
  result = await work(j, {
    root: dir,
    runId: probe.runId,
    build: "test-build",
    transportFactory,
  });
  assert.equal(result[0].status, "partial");
});
test("all API pages reconcile total, resume consumes original request budget, repeats are detected", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const c = {
    ...config(),
    apiEndpoint:
      "https://laconventioncenter.com/wp-json/tribe/events/v1/events",
  };
  const { j } = setup(t, [c]);
  const pages = [1, 2, 3].map((n) => ({
    ...tribe,
    total: 3,
    total_pages: 3,
    events: [{ ...tribe.events[0], id: n }],
  }));
  const factory = () => ({
    fetch: async (task) => ({
      body: JSON.stringify(
        pages[Number(new URL(task.url).searchParams.get("page")) - 1],
      ),
      url: task.url,
      capture,
    }),
    close: async () => {},
  });
  const q = j.enqueue(c.id, options({ transport: "api", maxPages: 2 }));
  let out = await work(j, {
    root: dir,
    runId: q.runId,
    build: "test-build",
    transportFactory: factory,
  });
  assert.equal(out[0].status, "partial");
  assert.equal(out[0].pendingPages, 1);
  assert.equal(j.records(q.runId).length, 2);
  j.resume(q.runId, { maxPages: 3 });
  out = await work(j, {
    root: dir,
    runId: q.runId,
    build: "test-build",
    transportFactory: factory,
  });
  assert.equal(out[0].status, "complete");
  assert.equal(j.run(q.runId).requests, 3);
  const next = j.enqueue(c.id, options({ transport: "api" })),
    r = j.claim("x"),
    p = j.nextPage(next.runId, r.token);
  const result = {
    ...blank,
    records: [{ sourceRecordId: "1" }],
    nextRequests: [
      {
        url: "https://laconventioncenter.com/page2",
        meta: { pagination: true },
      },
    ],
  };
  j.commitPage(r.id, r.token, p, result, capture);
  const two = j.nextPage(r.id, r.token);
  assert.throws(
    () => j.commitPage(r.id, r.token, two, result, capture),
    (e) => e.code === "pagination_changed",
  );
});
test("source failures preserve the last complete and last good pointers", (t) => {
  const { j } = setup(t);
  const good = complete(j, la.id),
    q = j.enqueue(la.id, options()),
    r = j.claim("x");
  j.finish(
    r.id,
    r.token,
    "repair_needed",
    { recordCount: 0 },
    { code: "contract_changed" },
  );
  assert.equal(j.collection(la.id).last_complete, good.id);
  assert.equal(j.collection(la.id).last_good, good.id);
  assert.equal(j.repairs().length, 1);
});
test("repair claims are fenced; closing requires two complete runs on the probation build", (t) => {
  const { j, advance } = setup(t);
  j.enqueue(la.id, options());
  const r = j.claim("x");
  j.finish(
    r.id,
    r.token,
    "repair_needed",
    { recordCount: 0 },
    { code: "contract_changed" },
  );
  const repair = j.repairs()[0],
    claim = j.claimRepair(repair.id, "engineer");
  assert.throws(() => j.claimRepair(repair.id, "other"));
  assert.throws(() => j.probation(repair.id, "wrong", "test-build"));
  j.probation(repair.id, claim.token, "test-build");
  advance(1);
  complete(j, la.id);
  assert.deepEqual(j.resolveRepairs("test-build"), []);
  advance(1);
  complete(j, la.id);
  assert.deepEqual(j.resolveRepairs("test-build"), [repair.id]);
});
test("wrong parser build cannot silently reinterpret a frozen run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-build-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { j } = setup(t);
  j.enqueue(la.id, options());
  const result = await work(j, {
    root: dir,
    build: "new-build",
    transportFactory: () => ({ close: async () => {} }),
  });
  assert.equal(result[0].error.code, "adapter_build_changed");
});
test("robots rules use longest matching path, agent groups and Allow ties", () => {
  const txt =
    "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*?secret=\n";
  assert.equal(robotsAllowed(txt, "/events"), true);
  assert.equal(robotsAllowed(txt, "/private/x"), false);
  assert.equal(robotsAllowed(txt, "/private/public/x"), true);
  assert.equal(robotsAllowed(txt, "/events?secret=x"), false);
  assert.equal(
    robotsAllowed(
      "User-agent: EventsMiningFramework\nDisallow: /\nUser-agent: *\nAllow: /",
      "/events",
    ),
    false,
  );
  assert.equal(
    robotsAllowed("User-agent: *\nDisallow: /events$", "/events/more"),
    true,
  );
  assert.equal(retryDelay("60"), 60000);
});
test("date parsing does not guess missing years or accept impossible dates", () => {
  assert.equal(dates("Oct 17").startDate, null);
  assert.equal(dates("Feb 30, 2026").startDate, null);
  assert.equal(dates("Oct 17-19, 2026").endDate, "2026-10-19");
});
test("structured event graphs preserve recurring dates, and generic discovery stays unverified", () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@graph": [
        {
          "@type": "MusicEvent",
          "@id": "https://x.test/a",
          name: "Concert",
          startDate: "2026-10-17",
        },
        {
          "@type": "MusicEvent",
          "@id": "https://x.test/a",
          name: "Concert",
          startDate: "2026-10-18",
        },
      ],
    }) +
    "</script>";
  const events = jsonLdEvents(html).events.map(({ event }) =>
    recordFromJsonLd(la, event, { url: "https://x.test" }),
  );
  assert.notEqual(events[0].sourceRecordId, events[1].sourceRecordId);
  const parsed = parseDocument({
    html,
    url: la.url,
    config: {
      ...la,
      adapter: "discovery",
      coverage: "unverified",
      maxDepth: 0,
    },
  });
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.coverage, "unverified");
  assert.equal(parsed.terminal, false);
});

test("unexpected count collapse is quarantined instead of replacing a complete collection", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-collapse-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { j } = setup(t);
  complete(j, la.id, 1000);
  const q = j.enqueue(la.id, options());
  const result = await work(j, {
    root: dir,
    runId: q.runId,
    build: "test-build",
    transportFactory: () => ({
      fetch: async () => ({ body: laHtml, url: la.url, capture }),
      close: async () => {},
    }),
  });
  assert.equal(result[0].status, "partial");
  assert.ok(result[0].issues.some((i) => i.code === "record_count_collapsed"));
});
test("export failures retain committed outcome and can be retried separately", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-export-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { j } = setup(t);
  const q = j.enqueue(la.id, options());
  const { writeFile } = await import("node:fs/promises");
  const file = join(dir, "is-a-file");
  await writeFile(file, "x");
  const result = await work(j, {
    root: file,
    runId: q.runId,
    build: "test-build",
    transportFactory: () => ({
      fetch: async () => ({ body: laHtml, url: la.url, capture }),
      close: async () => {},
    }),
  });
  assert.equal(j.run(q.runId).status, "complete");
  assert.ok(result[0].exportError);
  assert.equal(j.records(q.runId).length, 2);
});

test("a failed probation run reopens the repair and cannot later be resolved accidentally", (t) => {
  const { j } = setup(t);
  j.enqueue(la.id, options());
  let r = j.claim("x");
  j.finish(r.id, r.token, "partial", { recordCount: 1 });
  const repair = j.repairs()[0],
    claim = j.claimRepair(repair.id, "engineer");
  j.probation(repair.id, claim.token, "test-build");
  j.enqueue(la.id, options());
  r = j.claim("x");
  j.finish(r.id, r.token, "partial", { recordCount: 1 });
  assert.equal(j.repairs()[0].status, "open");
  assert.deepEqual(j.resolveRepairs("test-build"), []);
});
test("resume cannot silently change enumeration scope or reduce spent budgets", (t) => {
  const { j } = setup(t);
  j.enqueue(la.id, options());
  const r = j.claim("x");
  j.finish(r.id, r.token, "partial", { recordCount: 1 });
  assert.throws(() => j.resume(r.id, { transport: "api" }));
  assert.throws(() => j.resume(r.id, { maxPages: 1 }));
});

test("a killed process leaves a recoverable in-flight page and keeps its earlier checkpoint", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-crash-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "journal.sqlite");
  const { spawn } = await import("node:child_process");
  const code = `import{Journal}from'./src/storage/journal.mjs';const j=new Journal(process.argv[1]);const c=JSON.parse(process.argv[2]);j.register([c]);const q=j.enqueue(c.id,{}),r=j.claim('doomed',1000),p=j.nextPage(r.id,r.token);j.commitPage(r.id,r.token,p,{records:[{sourceRecordId:'saved'}],nextRequests:[{url:c.url+'?page=2'}],issues:[]},{path:'fixture',hash:'test'});j.nextPage(r.id,r.token);console.log(JSON.stringify({id:r.id,token:r.token}));setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, file, JSON.stringify(config())],
    { cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (!child.killed) child.kill("SIGKILL");
  });
  const ready = await new Promise((resolve, reject) => {
    let data = "";
    const timeout = setTimeout(
      () => reject(new Error("child readiness timeout")),
      10000,
    );
    child.stdout.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        clearTimeout(timeout);
        resolve(JSON.parse(data));
      }
    });
    child.once("error", reject);
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
  const j = new Journal(file, () => Date.now() + 2000);
  t.after(() => j.close());
  assert.equal(j.records(ready.id).length, 1);
  assert.deepEqual(j.recover(), [ready.id]);
  assert.deepEqual(
    j.pages(ready.id).map((p) => p.state),
    ["done", "pending"],
  );
  const replacement = j.claim("replacement");
  assert.notEqual(replacement.token, ready.token);
  assert.equal(j.run(ready.id).requests, 2);
});

test("quality-quarantined samples preserve last good and a page cannot be committed under another run", (t) => {
  const { j } = setup(t, [config(), config("url-037", "another.example")]);
  const good = complete(j, la.id, 100);
  j.enqueue(la.id, options());
  const r = j.claim("one");
  const p = j.nextPage(r.id, r.token);
  const q = j.enqueue("url-037", options()),
    other = j.claim("two", 60000, q.runId),
    otherPage = j.nextPage(other.id, other.token);
  assert.throws(
    () => j.commitPage(r.id, r.token, otherPage, blank, capture),
    /not in flight/,
  );
  j.finish(r.id, r.token, "partial", {
    recordCount: 1,
    issues: [{ code: "record_count_collapsed" }],
  });
  assert.equal(j.collection(la.id).last_good, good.id);
});

test("a detail link that leaves the publisher is recorded and does not stop the run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-offhost-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const orlando = configs.find((c) => c.id === "url-079"),
    html = await readFile(
      new URL("fixtures/orlando.html", import.meta.url),
      "utf8",
    );
  const j = new Journal(":memory:");
  j.register([orlando]);
  t.after(() => j.close());
  const requested = [];
  const transportFactory = () => ({
    fetch: async (task) => {
      requested.push(task.kind);
      if (task.kind === "detail")
        throw Object.assign(new Error("Out-of-scope navigation host"), {
          code: "scope_violation",
          capture: {
            path: "/saved/venue.html",
            hash: "venue",
            url: "https://venue.example.org/festival",
          },
        });
      return { body: html, url: orlando.url, capture, status: 200 };
    },
    close: async () => {},
  });
  const q = j.enqueue(
    orlando.id,
    optionsFor(orlando, { asOf: "2026-10-16" }, "test-build"),
  );
  const [result] = await work(j, {
    root: dir,
    runId: q.runId,
    build: "test-build",
    transportFactory,
  });
  assert.ok(requested.includes("detail"));
  assert.notEqual(result.status, "repair_needed");
  assert.notEqual(result.error?.code, "scope_violation");
  assert.equal(result.pendingPages, 0);
  const skipped = j
    .pages(q.runId)
    .filter((p) => p.kind === "detail" && p.state === "done");
  assert.ok(skipped.length > 0);
});
