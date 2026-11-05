import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { Journal } from "../src/storage/journal.mjs";
import {
  connect,
  migrate,
  snapshotRun,
  deliverSnapshot,
  eventsDatabaseUrl,
  clientConfig,
  MIGRATIONS_DIR,
} from "../src/storage/postgres.mjs";
import { deliver } from "../src/delivery.mjs";
import { disposableDatabase } from "./helpers/postgres.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const config = {
  id: "url-901",
  url: "https://example.test/events",
  rateKey: "example.test",
  entrypoints: ["https://example.test/events"],
};
const record = (id, extra = {}) => ({
  schemaVersion: 3,
  collectionId: "url-901",
  sourceRecordId: id,
  title: `Event ${id}`,
  url: `https://example.test/e/${id}`,
  startDate: "2026-12-01",
  endDate: "not-a-date",
  startLocal: "2026-12-01T19:00:00",
  timeZone: "America/New_York",
  marketCity: "Boston",
  ...extra,
});

// A real file journal with one finished run, captured evidence, a detail
// enrichment and a same-day expansion.
async function journalRoot(
  t,
  { status = "complete", records = ["a", "b", "c"] } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "events-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const j = new Journal(join(root, "journal.sqlite"));
  j.register([config]);
  const q = j.enqueue(config.id, { asOf: "2026-11-04", buildId: "test-build" });
  const r = j.claim("test", 60000, q.runId);
  const listing = j.nextPage(q.runId, r.token);
  const html = "<html>listing é</html>",
    listingPath = join(root, "page-1.html");
  await writeFile(listingPath, html);
  j.commitPage(
    r.id,
    r.token,
    listing,
    {
      records: records.map((id) => record(id)),
      nextRequests: [
        {
          url: "https://example.test/e/a",
          kind: "detail",
          depth: 1,
          meta: { enrichRecordIds: ["a"] },
        },
        {
          url: "https://example.test/e/b",
          kind: "detail",
          depth: 1,
          meta: { enrichRecordIds: ["b"] },
        },
      ],
      issues: [],
      terminal: true,
    },
    { path: listingPath, hash: sha(html) },
  );
  for (const key of ["a", "b"]) {
    const page = j.nextPage(q.runId, r.token),
      body = `<html>detail ${key}</html>`,
      path = join(root, `page-${page.id}.html`);
    await writeFile(path, body);
    j.commitPage(
      r.id,
      r.token,
      page,
      {
        records: [],
        nextRequests: [],
        issues: [],
        ...(key === "a"
          ? { enrichments: [record("a", { location: { venue: "Hall" } })] }
          : {
              expansions: [
                {
                  parentRecordId: "b",
                  records: [record("b|1"), record("b|2")],
                },
              ],
            }),
      },
      { path, hash: sha(body) },
    );
  }
  j.finish(r.id, r.token, status, { recordCount: records.length });
  j.close();
  return { root, runId: r.id };
}

const count = async (c, sql, params = []) =>
  Number((await c.query(sql, params)).rows[0].n);

async function withDb(t) {
  const url = await disposableDatabase(t);
  if (!url) {
    t.skip("PostgreSQL binaries (initdb) or EVENTS_TEST_PG_URL unavailable");
    return null;
  }
  return url;
}

test("migrations apply once, are serialized and reject edited history", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const c = await connect(url);
  t.after(() => c.end());
  const first = await migrate(c);
  assert.deepEqual(first.applied, ["001_source_observations.sql"]);
  assert.deepEqual((await migrate(c)).applied, []);
  const dir = await mkdtemp(join(tmpdir(), "events-migrations-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  await writeFile(join(dir, "001_source_observations.sql"), "-- edited\n", {
    flag: "a",
  });
  await assert.rejects(migrate(c, { dir }), /was modified/);
});

test("a complete run is delivered once with counts, evidence and projections intact", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const { root, runId } = await journalRoot(t);
  const journalBytes = await readFile(join(root, "journal.sqlite"));
  const report = await deliver({ url, roots: [root], applyMigrations: true });
  assert.equal(report.journals[0].delivered, 1);
  assert.deepEqual(report.migrations.applied, ["001_source_observations.sql"]);
  assert.deepEqual(
    await readFile(join(root, "journal.sqlite")),
    journalBytes,
    "journal not written",
  );
  const c = await connect(url);
  t.after(() => c.end());
  assert.equal(
    await count(
      c,
      "SELECT count(*) n FROM source_observations WHERE run_id=$1",
      [runId],
    ),
    3,
  );
  assert.equal(
    await count(c, "SELECT count(*) n FROM observation_enrichments"),
    1,
  );
  assert.equal(
    await count(c, "SELECT count(*) n FROM observation_expansions"),
    2,
  );
  const row = (
    await c.query(
      "SELECT start_date::text, end_date, title FROM source_observations WHERE record_key='a'",
    )
  ).rows[0];
  assert.deepEqual(
    row,
    { start_date: "2026-12-01", end_date: null, title: "Event a" },
    "invalid dates stay null",
  );
  // Same projection as the journal: b is replaced by its two sessions, a is enriched.
  const projected = (
    await c.query(
      "SELECT record_key, projection, payload->'location'->>'venue' venue FROM current_source_records ORDER BY record_key",
    )
  ).rows;
  const local = new Journal(join(root, "journal.sqlite"), Date.now, {
    readOnly: true,
  });
  t.after(() => local.close());
  assert.deepEqual(
    projected.map((r) => r.record_key),
    local
      .records(runId)
      .map((r) => r.sourceRecordId)
      .sort(),
  );
  assert.deepEqual(
    projected.map((r) => r.projection),
    ["enriched", "expansion", "expansion", "listing"],
  );
  assert.equal(projected[0].venue, "Hall");
  // Evidence bytes are retrievable and hash to the recorded capture identity.
  const ev = (
    await c.query("SELECT content_hash, content_gzip FROM evidence_objects")
  ).rows;
  assert.equal(ev.length, 3);
  for (const e of ev)
    assert.equal(sha(gunzipSync(e.content_gzip)), e.content_hash);
  assert.equal(await count(c, "SELECT count(*) n FROM import_receipts"), 1);

  // Second pass: the local outbox already holds the receipt.
  const again = await deliver({ url, roots: [root] });
  assert.equal(again.journals[0].skipped, 1);
  // Crash after the database commit but before the local receipt: replay is a duplicate.
  await rm(join(root, "delivery.sqlite"));
  const replay = await deliver({ url, roots: [root] });
  assert.equal(replay.journals[0].duplicates, 1);
  assert.equal(
    replay.journals[0].runs[0].receiptId,
    report.journals[0].runs[0].receiptId,
  );
  assert.equal(await count(c, "SELECT count(*) n FROM source_observations"), 3);
  assert.equal(await count(c, "SELECT count(*) n FROM import_receipts"), 1);
});

test("an interrupted delivery rolls back completely and a retry succeeds", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const { root, runId } = await journalRoot(t);
  const c = await connect(url);
  t.after(() => c.end());
  await migrate(c);
  const j = new Journal(join(root, "journal.sqlite"), Date.now, {
    readOnly: true,
  });
  t.after(() => j.close());
  const snap = snapshotRun(j, runId);
  // Fail on the final receipt insert, after every data table was written.
  const failing = {
    query: (sql, params) =>
      /INSERT INTO import_receipts/.test(sql)
        ? Promise.reject(
            Object.assign(new Error("simulated interruption"), {
              code: "test",
            }),
          )
        : c.query(sql, params),
  };
  await assert.rejects(
    deliverSnapshot(failing, snap),
    /simulated interruption/,
  );
  for (const table of [
    "extraction_runs",
    "run_pages",
    "source_observations",
    "evidence_objects",
    "import_receipts",
  ])
    assert.equal(await count(c, `SELECT count(*) n FROM ${table}`), 0, table);
  const ok = await deliverSnapshot(c, snap);
  assert.equal(ok.duplicate, false);
  assert.equal(await count(c, "SELECT count(*) n FROM source_observations"), 3);
});

test("a database outage changes nothing locally and is retried later", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const { root } = await journalRoot(t);
  const before = await readFile(join(root, "journal.sqlite"));
  const down = "postgres://nobody:secret@127.0.0.1:9/none?sslmode=disable";
  await assert.rejects(deliver({ url: down, roots: [root] }), (e) => {
    assert.equal(e.report.journals[0].failed, 1);
    return true;
  });
  assert.deepEqual(await readFile(join(root, "journal.sqlite")), before);
  const outbox = new DatabaseSync(join(root, "delivery.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    outbox.prepare("SELECT status FROM deliveries").get().status,
    "failed",
  );
  outbox.close();
  const later = await deliver({ url, roots: [root], applyMigrations: true });
  assert.equal(later.journals[0].delivered, 1);
});

test("a resumed run gets a new receipt; changed payloads for a delivered key are rejected", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const { root, runId } = await journalRoot(t, { status: "partial" });
  await deliver({ url, roots: [root], applyMigrations: true });
  // Simulate a resumed run that appended one observation and finished complete.
  const db = new DatabaseSync(join(root, "journal.sqlite"));
  db.prepare(
    "INSERT INTO observations(run_id,record_key,payload,page_id) VALUES(?,?,?,1)",
  ).run(runId, "d", JSON.stringify(record("d")));
  db.prepare(
    "UPDATE runs SET status='complete', updated=updated+1000 WHERE id=?",
  ).run(runId);
  db.close();
  const resumed = await deliver({ url, roots: [root] });
  assert.equal(resumed.journals[0].delivered, 1);
  const c = await connect(url);
  t.after(() => c.end());
  assert.equal(await count(c, "SELECT count(*) n FROM source_observations"), 4);
  assert.equal(await count(c, "SELECT count(*) n FROM import_receipts"), 2);
  assert.equal(
    (await c.query("SELECT status FROM extraction_runs")).rows[0].status,
    "complete",
  );
  assert.equal(
    await count(c, "SELECT count(*) n FROM current_complete_runs"),
    1,
  );
  // Tampering with an append-only observation is a conflict, not an overwrite.
  const tamper = new DatabaseSync(join(root, "journal.sqlite"));
  tamper
    .prepare(
      "UPDATE observations SET payload=? WHERE run_id=? AND record_key='a'",
    )
    .run(JSON.stringify(record("a", { title: "Changed" })), runId);
  tamper.prepare("UPDATE runs SET updated=updated+1000 WHERE id=?").run(runId);
  tamper.close();
  const conflict = await deliver({ url, roots: [root] });
  assert.equal(conflict.journals[0].failed, 1);
  assert.match(conflict.journals[0].runs[0].error, /payload_conflict/);
  assert.equal(
    (
      await c.query(
        "SELECT title FROM source_observations WHERE record_key='a'",
      )
    ).rows[0].title,
    "Event a",
  );
});

test("legacy journals without enrichment tables and non-terminal runs", async (t) => {
  const url = await withDb(t);
  if (!url) return;
  const { root, runId } = await journalRoot(t);
  const db = new DatabaseSync(join(root, "journal.sqlite"));
  db.exec(
    "PRAGMA foreign_keys=OFF; DROP TABLE record_expansions; DROP TABLE record_enrichments; PRAGMA user_version=1;",
  );
  db.close();
  const report = await deliver({ url, roots: [root], applyMigrations: true });
  assert.equal(report.journals[0].delivered, 1);
  assert.equal(report.journals[0].runs[0].counts.enrichments, 0);
  const j = new Journal(join(root, "journal.sqlite"), Date.now, {
    readOnly: true,
  });
  t.after(() => j.close());
  const live = new DatabaseSync(join(root, "journal.sqlite"));
  live.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId);
  live.close();
  assert.throws(() => snapshotRun(j, runId), /not terminal/);
});

test("connection policy uses only DB_EVENTS_URL and TLS by default", () => {
  assert.throws(
    () => eventsDatabaseUrl({ env: { DATABASE_URL: "postgres://u:p@h/db" } }),
    /DB_EVENTS_URL is not set/,
  );
  assert.equal(
    eventsDatabaseUrl({
      env: {
        DB_EVENTS_URL: "postgres://u:p@h/db",
        DATABASE_URL: "postgres://x:y@z/w",
      },
    }),
    "postgres://u:p@h/db",
  );
  assert.throws(
    () => eventsDatabaseUrl({ env: { DB_EVENTS_URL: "mysql://u:p@h/db" } }),
    /postgres/,
  );
  assert.deepEqual(clientConfig("postgres://u:p@h:1/db?sslmode=require").ssl, {
    rejectUnauthorized: false,
  });
  assert.deepEqual(clientConfig("postgres://u:p@h:1/db").ssl, {
    rejectUnauthorized: false,
  });
  assert.equal(
    clientConfig("postgres://u:p@h:1/db?sslmode=disable").ssl,
    false,
  );
  assert.ok(
    !clientConfig(
      "postgres://u:p@h:1/db?sslmode=require",
    ).connectionString.includes("sslmode"),
  );
});
