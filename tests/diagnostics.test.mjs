import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  cp,
  symlink,
  access,
  readdir,
  realpath,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Journal, hash } from "../src/storage/journal.mjs";
import { registry } from "../src/registry.mjs";
import { optionsFor, work } from "../src/worker.mjs";
import {
  inspectSource,
  replayPage,
  replayRun,
  compareRecords,
  writeBundle,
  replayBundle,
} from "../src/diagnostics.mjs";
import { assessQuality, validateQualityPolicy } from "../src/quality.mjs";
import { eventRecord } from "../src/records.mjs";
import { matchDetailBindings } from "../src/event-fields.mjs";
import { parseDocument } from "../src/adapters/document.mjs";

const configs = await registry(),
  base = configs.find((c) => c.id === "url-039");
const policy = {
  scope: "fixture-calendar",
  minRecords: 1,
  minCoverage: { startDate: 1, textLocation: 1 },
  maxRejectedRate: 0,
  maxCoverageDrop: 0.2,
  baselineMinRecords: 1,
};
const record = (extra = {}) =>
  eventRecord(
    base,
    {
      title: "Community dance",
      url: "https://www.choosechicago.com/event/dance",
      startDate: "2026-10-25T18:00:00-05:00",
      endDate: "2026-10-25T20:00:00-05:00",
      location: { venue: "Town Hall" },
      ...extra,
    },
    { url: base.url },
  );
async function setup(
  t,
  config = {
    ...base,
    defaultTransport: "browser",
    coverage: "verified-list",
    quality: policy,
  },
) {
  const root = await mkdtemp(join(tmpdir(), "events-diagnostics-"));
  const journal = new Journal(join(root, "journal.sqlite"));
  journal.register([config]);
  t.after(() => {
    journal.close();
    return rm(root, { recursive: true, force: true });
  });
  return { journal, root, config };
}
test("quality policies catch lost addresses despite unchanged event count and allow unknown ends", () => {
  const healthy = assessQuality([record()], [], policy);
  assert.equal(healthy.status, "passed");
  const bad = assessQuality(
    [record({ location: null, endDate: null })],
    [],
    policy,
    healthy,
  );
  assert.equal(bad.status, "failed");
  assert.ok(
    bad.failures.some(
      (f) => f.field === "textLocation" && f.rule === "maxCoverageDrop",
    ),
  );
  assert.equal(
    assessQuality([record({ endDate: null })], [], policy).status,
    "passed",
  );
  assert.equal(assessQuality([], [], policy).status, "failed");
  assert.equal(assessQuality([record()], [], null).status, "unconfigured");
  assert.equal(
    assessQuality([record()], [], policy, { ...healthy, scope: "other-query" })
      .baselineCompared,
    false,
  );
  for (const p of [
    { ...policy, minCoverage: { typo: 1 } },
    { ...policy, maxCoverageDrop: NaN },
    { ...policy, minRecords: 0 },
  ])
    assert.throws(() => validateQualityPolicy(p));
});

test("quality failures open repair and preserve last complete output in a real worker pass", async (t) => {
  const { journal: j, root, config } = await setup(t);
  let location = { "@type": "Place", name: "Town Hall" };
  const transportFactory = () => ({
    async fetch(task) {
      const body = `<nav class="tribe-events-c-nav"></nav><script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Community dance", url: "https://www.choosechicago.com/event/dance", startDate: "2026-10-25T18:00:00-05:00", endDate: "2026-10-25T20:00:00-05:00", location })}</script>`;
      const path = join(root, `${task.id}.html`);
      await writeFile(path, body);
      return {
        body,
        url: task.url,
        status: 200,
        capture: { path, hash: hash(body) },
      };
    },
    async close() {},
  });
  const a = j.enqueue(
    config.id,
    optionsFor(config, { asOf: "2026-10-25" }, "test"),
  );
  assert.equal(
    (await work(j, { root, build: "test", transportFactory }))[0].status,
    "complete",
  );
  location = null;
  const b = j.enqueue(
    config.id,
    optionsFor(config, { asOf: "2026-10-25" }, "test"),
  );
  const bad = (await work(j, { root, build: "test", transportFactory }))[0];
  assert.equal(bad.status, "repair_needed");
  assert.equal(bad.enumeration.complete, true);
  assert.equal(bad.quality.status, "failed");
  assert.equal(j.collection(config.id).last_complete, a.runId);
  assert.equal(j.collection(config.id).last_good, a.runId);
  assert.equal(
    j.repairs().find((r) => r.run_id === b.runId).code,
    "source_quality_failed",
  );
  const comparison = compareRecords(j.records(a.runId), j.records(b.runId));
  assert.equal(comparison.changedCount, 1);
  assert.equal(comparison.addedCount, 0);
});

test("API captures replay offline, detect tampering, and produce a portable diagnostic bundle", async (t) => {
  const config = configs.find((c) => c.id === "url-019");
  const { journal: j, root } = await setup(t, config);
  const body = await readFile(
    new URL("fixtures/tribe-page.json", import.meta.url),
    "utf8",
  );
  const q = j.enqueue(
    config.id,
    optionsFor(config, { asOf: "2026-10-25", transport: "api" }, "original"),
  );
  const r = j.claim("test"),
    page = j.nextPage(q.runId, r.token),
    path = join(root, "api.json");
  await writeFile(path, body);
  const { result } = await replayFixture();
  j.commitPage(
    r.id,
    r.token,
    page,
    { ...result, nextRequests: [] },
    { path, hash: hash(body) },
  );
  j.finish(r.id, r.token, "partial", { recordCount: result.records.length });
  async function replayFixture() {
    const { parseApi } = await import("../src/worker.mjs");
    return { result: parseApi(body, page.url, config, page) };
  }
  const replay = await replayPage(j, r.id, page.id, config);
  assert.equal(replay.kind, "api");
  assert.equal(replay.result.records.length, result.records.length);
  const all = await replayRun(j, r.id, config);
  assert.equal(all.replayComplete, true);
  assert.equal(compareRecords(j.records(r.id), all.records).changedCount, 0);
  const count = j.db.prepare("SELECT COUNT(*) AS n FROM actions").get().n;
  assert.equal(inspectSource(j, config.id, config).run.id, r.id);
  const out = join(root, "packet");
  await writeBundle(j, r.id, config, out);
  assert.equal((await replayBundle(out, config)).comparison.changedCount, 0);
  const portable = spawnSync(
    process.execPath,
    [
      "scripts/framework.mjs",
      "replay-bundle",
      out,
      "--root",
      join(root, "absent-journal"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(portable.status, 0, portable.stderr);
  await assert.rejects(writeBundle(j, r.id, config, out), /EEXIST/);
  assert.equal(
    j.db.prepare("SELECT COUNT(*) AS n FROM actions").get().n,
    count,
  );
  const reader = new Journal(join(root, "journal.sqlite"), Date.now, {
    readOnly: true,
  });
  assert.throws(() => reader.configure(config.id, true), /readonly/i);
  reader.close();
  const cli = spawnSync(
    process.execPath,
    ["scripts/framework.mjs", "compare", r.id, "--root", root],
    { encoding: "utf8" },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).replayComplete, true);
  await writeFile(path, body + " ");
  await assert.rejects(replayPage(j, r.id, page.id, config), /integrity/);
  assert.equal((await replayRun(j, r.id, config)).replayComplete, false);
});

test("comparison preserves occurrence identity and detects field differences with stable object ordering", () => {
  const a = record(),
    b = {
      ...a,
      location: Object.fromEntries(Object.entries(a.location).reverse()),
    };
  assert.equal(compareRecords([a], [b]).changedCount, 0);
  const changed = { ...b, endDate: null };
  assert.equal(
    compareRecords([a], [changed]).changed[0].fields[0].field,
    "endDate",
  );
  assert.equal(
    compareRecords([a], [{ ...a, sourceRecordId: "different-occurrence" }])
      .removedCount,
    1,
  );
});

test("read-only diagnostics accept the legacy journal without creating enrichment tables", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "events-legacy-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "journal.sqlite"),
    writer = new Journal(file);
  writer.register([base]);
  writer.db.exec("DROP TABLE record_enrichments; PRAGMA user_version=1;");
  writer.close();
  const before = await readFile(file),
    reader = new Journal(file, Date.now, { readOnly: true });
  assert.deepEqual(reader.records("absent-run"), []);
  assert.equal(reader.db.prepare("PRAGMA user_version").get().user_version, 1);
  reader.close();
  assert.deepEqual(await readFile(file), before);
});

test("inspected same-day sessions expand atomically without overwriting the date-only observation", async (t) => {
  const config = configs.find((c) => c.id === "url-080"),
    { journal: j, root } = await setup(t, config);
  const html = await readFile(
      new URL("fixtures/orlando-sessions.html", import.meta.url),
      "utf8",
    ),
    url = "https://www.downtownorlando.com/Fun/Events/Mitch-Rossell";
  const listing = eventRecord(
    config,
    {
      title: "Mitch Rossell",
      url,
      startDate: "2026-10-25",
      endDate: "2026-10-25",
    },
    { url: config.url },
  );
  const details = parseDocument({
    html,
    url,
    config,
    task: { kind: "detail" },
  }).records;
  assert.equal(details.length, 2);
  const bound = matchDetailBindings([listing], details, config);
  assert.equal(bound.matched, 1);
  assert.equal(bound.expansions[0].records.length, 2);
  assert.equal(
    matchDetailBindings([listing], details, {
      ...config,
      expandSameDaySessions: false,
    }).matched,
    0,
  );
  assert.equal(
    matchDetailBindings(
      [{ ...listing, startLocal: details[0].startLocal }],
      details,
      config,
    ).expansions.length,
    0,
  );
  const q = j.enqueue(
      config.id,
      optionsFor(config, { asOf: "2026-10-25" }, "test"),
    ),
    r = j.claim("test"),
    page = j.nextPage(q.runId, r.token);
  const captured = { path: join(root, "listing.html"), hash: "test" };
  j.commitPage(
    r.id,
    r.token,
    page,
    {
      records: [listing],
      nextRequests: [
        {
          url,
          kind: "detail",
          depth: 1,
          meta: { enrichRecordIds: [listing.sourceRecordId] },
        },
      ],
    },
    captured,
  );
  const detailPage = j.nextPage(r.id, r.token);
  await writeFile(join(root, "detail.html"), html);
  assert.throws(
    () =>
      j.commitPage(
        r.id,
        r.token,
        detailPage,
        {
          records: [],
          expansions: [
            {
              parentRecordId: listing.sourceRecordId,
              records: [details[0], details[0]],
            },
          ],
          nextRequests: [],
        },
        captured,
      ),
    /expansion/,
  );
  assert.equal(j.records(r.id).length, 1);
  j.commitPage(
    r.id,
    r.token,
    detailPage,
    { records: [], ...bound, nextRequests: [] },
    { path: join(root, "detail.html"), hash: hash(html) },
  );
  const projected = j.records(r.id);
  assert.equal(projected.length, 2);
  assert.notEqual(projected[0].sourceRecordId, projected[1].sourceRecordId);
  assert.equal(
    JSON.parse(
      j.db.prepare("SELECT payload FROM observations WHERE run_id=?").get(r.id)
        .payload,
    ).startLocal,
    null,
  );
  assert.equal(
    j.db
      .prepare("SELECT COUNT(*) AS n FROM record_expansions WHERE run_id=?")
      .get(r.id).n,
    2,
  );
});

test("foreground validator rejects an operational journal root from another cwd and through a symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "events-validator-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, "project/scripts"),
    protectedRoot = join(root, "project/.artifacts/framework");
  await mkdir(scripts, { recursive: true });
  await mkdir(protectedRoot, { recursive: true });
  const script = join(scripts, "validate-collectors.mjs");
  await cp(
    new URL("../scripts/validate-collectors.mjs", import.meta.url),
    script,
  );
  await writeFile(
    join(protectedRoot, "journal.sqlite"),
    "operational sentinel",
  );
  const alias = join(root, "alias");
  await symlink(protectedRoot, alias);
  for (const path of [
    protectedRoot,
    alias,
    join(protectedRoot, "new-campaign", "nested"),
    join(alias, "new-campaign", "nested"),
  ]) {
    const result = spawnSync(process.execPath, [script, "--root", path], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /separate validation storage/);
  }
  assert.equal(
    await readFile(join(protectedRoot, "journal.sqlite"), "utf8"),
    "operational sentinel",
  );
  await assert.rejects(access(join(protectedRoot, "candidates")));
  await assert.rejects(access(join(protectedRoot, "new-campaign")));
});

test("foreground validator resolves snapshot dependencies with an external root or working directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "events-validator-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(
    new URL("../scripts/validate-collectors.mjs", import.meta.url),
  );
  for (const explicitRoot of [true, false]) {
    const result = spawnSync(
      process.execPath,
      [
        script,
        ...(explicitRoot ? ["--root", join(root, "absolute")] : []),
        "--ids",
        "url-999",
      ],
      { cwd: root, encoding: "utf8", timeout: 15000 },
    );
    // Invalid selection must be reached after importing real copied modules,
    // before a journal or any collector can acquire publisher content.
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unknown source ID/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
    const campaigns = join(root, ".artifacts/source-validation");
    const campaign = explicitRoot
      ? join(root, "absolute")
      : join(campaigns, (await readdir(campaigns))[0]);
    const candidates = join(campaign, "candidates");
    const snapshot = join(candidates, (await readdir(candidates))[0]);
    assert.equal(
      await realpath(join(snapshot, "node_modules")),
      await realpath(new URL("../node_modules", import.meta.url)),
    );
    const worker = join(snapshot, "src/worker.mjs");
    assert.equal((await lstat(worker)).isSymbolicLink(), false);
    assert.equal(
      await readFile(worker, "utf8"),
      await readFile(new URL("../src/worker.mjs", import.meta.url), "utf8"),
    );
    await assert.rejects(access(join(campaign, "journal.sqlite")));
  }
});

test("a pending retry response cannot count as a complete replay even if its JSON parses", async (t) => {
  const config = configs.find((c) => c.id === "url-019"),
    { journal: j, root } = await setup(t, config);
  const body = await readFile(
      new URL("fixtures/tribe-page.json", import.meta.url),
      "utf8",
    ),
    path = join(root, "retry.json");
  await writeFile(path, body);
  const q = j.enqueue(
      config.id,
      optionsFor(config, { transport: "api", asOf: "2026-10-25" }, "test"),
    ),
    r = j.claim("test"),
    p = j.nextPage(q.runId, r.token);
  const capture = { path, hash: hash(body) },
    error = { code: "rate_limited", capture, retryAfterMs: 60000 };
  j.pageError(r.id, r.token, p.id, error, true, capture);
  j.finish(r.id, r.token, "retry_wait", { recordCount: 0 }, error);
  assert.ok(
    (await replayPage(j, r.id, p.id, config)).result.records.length > 0,
  );
  const replay = await replayRun(j, r.id, config);
  assert.equal(replay.replayComplete, false);
  assert.ok(
    replay.errors.some(
      (e) =>
        e.code === "page_not_committed" && e.state === "pending" && e.captured,
    ),
  );
  const cli = spawnSync(
    process.execPath,
    ["scripts/framework.mjs", "compare", r.id, "--root", root],
    { encoding: "utf8" },
  );
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).replayComplete, false);
  assert.equal(j.records(r.id).length, 0);
});

test("failed captured pages remain incomplete in replay and portable bundles", async (t) => {
  const config = configs.find((c) => c.id === "url-019");
  const { journal: j, root } = await setup(t, config);
  const body = await readFile(
    new URL("fixtures/tribe-page.json", import.meta.url),
    "utf8",
  );
  const q = j.enqueue(
    config.id,
    optionsFor(config, { transport: "api", asOf: "2026-10-25" }, "test"),
  );
  const run = j.claim("test");
  const page = j.nextPage(q.runId, run.token);
  const path = join(root, "failed.json");
  await writeFile(path, body);
  const capture = { path, hash: hash(body) };
  const error = { code: "pagination_changed", capture };
  j.pageError(run.id, run.token, page.id, error, false, capture);
  j.finish(run.id, run.token, "repair_needed", { recordCount: 0 }, error);
  assert.ok(
    (await replayPage(j, run.id, page.id, config)).result.records.length > 0,
  );
  const replay = await replayRun(j, run.id, config);
  assert.equal(replay.replayComplete, false);
  assert.ok(
    replay.errors.some(
      (e) =>
        e.code === "page_not_committed" && e.state === "failed" && e.captured,
    ),
  );
  const packet = join(root, "failed-packet");
  assert.equal(
    (await writeBundle(j, run.id, config, packet)).replayComplete,
    false,
  );
  assert.equal((await replayBundle(packet, config)).replayComplete, false);
  for (const args of [
    ["compare", run.id, "--root", root],
    ["replay-bundle", packet],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/framework.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).replayComplete, false);
  }
  assert.equal(j.records(run.id).length, 0);
});

test("detail observations cannot dilute listing rejection quality", () => {
  const quality = assessQuality(
    [record()],
    [
      { observedCount: 100, rejected: 3, acquisition: { kind: "listing" } },
      { observedCount: 97, rejected: 0, acquisition: { kind: "detail" } },
    ],
    { scope: "fixture", maxRejectedRate: 0.02 },
  );
  assert.equal(quality.metrics.observed, 100);
  assert.equal(quality.metrics.rejectedRate, 0.03);
  assert.equal(quality.status, "failed");
  const api = assessQuality(
    [record()],
    [{ observedCount: 100, rejected: 3, acquisition: { kind: "api" } }],
    { scope: "fixture", maxRejectedRate: 0.02 },
  );
  assert.equal(api.metrics.rejectedRate, 0.03);
});

test("offline replay keeps detail observations outside listing rejection counts", async (t) => {
  const config = {
    ...configs.find((c) => c.id === "url-035"),
    quality: { scope: "fixture", maxRejectedRate: 0.7 },
  };
  const listing =
    '<div class="view-events-day">' +
    '<article class="node--type-event"></article>'.repeat(3) +
    '<article class="node--type-event"><a data-description="Title link" data-start-date="2026-10-25" data-nid="1" data-content-title="Dance" data-venue="Hall" href="/event/2026/10/25/dance">Dance</a></article></div>';
  const detailUrl = new URL("/event/2026/10/25/dance", config.url).href;
  const detail = `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Dance", url: detailUrl, startDate: "2026-10-25" })}</script>`;
  const root = await mkdtemp(join(tmpdir(), "events-replay-quality-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pages = [];
  for (const [kind, body, url] of [
    ["listing", listing, config.url],
    ["detail", detail, detailUrl],
  ]) {
    const path = join(root, kind + ".html");
    await writeFile(path, body);
    pages.push({
      id: pages.length + 1,
      kind,
      state: "done",
      depth: kind === "detail" ? 1 : 0,
      meta: {},
      url,
      capture: path,
      content_hash: hash(body),
    });
  }
  const journal = {
    run: () => ({ id: "fixture", status: "repair_needed" }),
    pages: () => pages,
  };
  const replay = await replayRun(journal, "fixture", config);
  assert.equal(replay.replayComplete, true);
  assert.equal(replay.pages[1].result.observedCount, 1);
  assert.equal(replay.quality.metrics.observed, 4);
  assert.equal(replay.quality.metrics.rejected, 3);
  assert.equal(replay.quality.metrics.rejectedRate, 0.75);
  assert.equal(replay.quality.status, "failed");
});
