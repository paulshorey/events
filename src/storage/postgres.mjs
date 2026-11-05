import pg from "pg";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { hash } from "./journal.mjs";

export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
// Statuses written by Journal.finish/cancel that will not gain more pages
// without an explicit resume. A resumed run is redelivered with a new digest.
export const TERMINAL = [
  "complete",
  "partial",
  "repair_needed",
  "blocked_access",
  "cancelled",
  "failed",
];

// Only DB_EVENTS_URL is accepted; never fall back to DATABASE_URL. `local`
// reads the active assignment from .env.local, overriding inherited values.
export function eventsDatabaseUrl({ local = false, env = process.env } = {}) {
  const value = local
    ? parseEnv(readFileSync(".env.local", "utf8")).DB_EVENTS_URL
    : env.DB_EVENTS_URL;
  if (!value) throw new Error("DB_EVENTS_URL is not set");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DB_EVENTS_URL must be a postgres:// URL");
  return value;
}

// Railway's public TCP proxy is used with TLS (libpq sslmode=require: encrypted,
// certificate not verified). Loopback/unix-socket test clusters may disable TLS
// with sslmode=disable.
export function clientConfig(connectionString) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get("sslmode") ?? "require";
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.href,
    ssl:
      mode === "disable"
        ? false
        : { rejectUnauthorized: mode === "verify-full" },
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    application_name: "events-uploader",
  };
}

export async function connect(connectionString) {
  const client = new pg.Client(clientConfig(connectionString));
  await client.connect();
  return client;
}

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), "utf8");
      return { version: f.slice(0, 3), name: f, sql, checksum: hash(sql) };
    });
}

// Forward-only, checksum-guarded, serialized by an advisory lock. An edited
// applied migration fails instead of silently diverging.
export async function migrate(client, { dir = MIGRATIONS_DIR } = {}) {
  await client.query("SELECT pg_advisory_lock(hashtext('events.migrations'))");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map(
      (
        await client.query("SELECT version,checksum FROM schema_migrations")
      ).rows.map((r) => [r.version, r.checksum]),
    );
    const files = migrationFiles(dir),
      ran = [];
    for (const v of applied.keys())
      if (!files.some((f) => f.version === v))
        throw new Error(`Applied migration ${v} is missing locally`);
    for (const m of files) {
      if (applied.has(m.version)) {
        if (applied.get(m.version) !== m.checksum)
          throw new Error(`Applied migration ${m.name} was modified`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)",
          [m.version, m.name, m.checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      ran.push(m.name);
    }
    return { applied: ran, total: files.length };
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('events.migrations'))",
    );
  }
}

const json = (text) => (text == null ? null : JSON.parse(text));
// jsonb parameters: journal JSON text passes through; anything else is quoted.
const jsonText = (value) => {
  if (value == null) return null;
  try {
    JSON.parse(value);
    return value;
  } catch {
    return JSON.stringify(String(value));
  }
};
const ts = (ms) => (ms == null ? null : new Date(Number(ms)).toISOString());
const isoDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)
    ? v
    : null;
const text = (v) => (typeof v === "string" && v.trim() ? v : null);

// Read everything a terminal run needs from a (possibly legacy, read-only)
// journal. The digest covers the exact rows so a resumed run gets a new receipt.
export function snapshotRun(journal, runId) {
  const db = journal.db;
  const run = db.prepare("SELECT * FROM runs WHERE id=?").get(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  if (!TERMINAL.includes(run.status))
    throw new Error(`Run ${runId} is ${run.status}, not terminal`);
  const pages = db
    .prepare("SELECT * FROM pages WHERE run_id=? ORDER BY id")
    .all(runId);
  const observations = db
    .prepare(
      "SELECT record_key,page_id,payload FROM observations WHERE run_id=? ORDER BY record_key",
    )
    .all(runId);
  const enrichments = journal.hasEnrichments
    ? db
        .prepare(
          "SELECT record_key,page_id,payload FROM record_enrichments WHERE run_id=? ORDER BY record_key,page_id",
        )
        .all(runId)
    : [];
  const expansions = journal.hasExpansions
    ? db
        .prepare(
          "SELECT parent_key,record_key,page_id,payload FROM record_expansions WHERE run_id=? ORDER BY parent_key,record_key,page_id",
        )
        .all(runId)
    : [];
  const attempts = db
    .prepare("SELECT * FROM attempts WHERE run_id=? ORDER BY number,id")
    .all(runId);
  const counts = {
    pages: pages.length,
    observations: observations.length,
    enrichments: enrichments.length,
    expansions: expansions.length,
    attempts: attempts.length,
  };
  const digest = hash({
    run: [run.id, run.status, run.updated, run.result, run.error, run.revision],
    pages: pages.map((p) => [p.id, p.state, p.content_hash, p.tries]),
    observations: observations.map((o) => [o.record_key, hash(o.payload)]),
    enrichments: enrichments.map((o) => [
      o.record_key,
      o.page_id,
      hash(o.payload),
    ]),
    expansions: expansions.map((o) => [
      o.parent_key,
      o.record_key,
      o.page_id,
      hash(o.payload),
    ]),
  });
  return {
    run,
    pages,
    observations,
    enrichments,
    expansions,
    attempts,
    counts,
    digest,
  };
}

async function insertRows(client, table, columns, rows, conflict, cast = {}) {
  const BATCH = 400;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH),
      values = [],
      tuples = chunk.map(
        (row, r) =>
          `(${columns
            .map((c, k) => {
              values.push(row[k]);
              return `$${r * columns.length + k + 1}${cast[c] ?? ""}`;
            })
            .join(",")})`,
      );
    const res = await client.query(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES ${tuples.join(",")} ${conflict}`,
      values,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

// Append-only rows: an existing key must carry the same payload hash.
async function assertSamePayloads(client, table, keyCols, rows, runId) {
  if (!rows.length) return;
  const keyOf = (r) => keyCols.map((c) => r[c]).join("\u0000");
  const existing = new Map(
    (
      await client.query(
        `SELECT ${keyCols.join(",")},payload_hash FROM ${table} WHERE run_id=$1`,
        [runId],
      )
    ).rows.map((r) => [keyOf(r), r.payload_hash]),
  );
  for (const r of rows)
    if (existing.get(keyOf(r)) !== r.payload_hash)
      throw Object.assign(
        new Error(`${table} payload conflict for run ${runId}`),
        { code: "payload_conflict" },
      );
}

// Deliver one run snapshot in a single transaction. Idempotent: replaying the
// same snapshot inserts nothing new and returns the original receipt.
export async function deliverSnapshot(
  client,
  snap,
  { origin = {}, evidence = true } = {},
) {
  const { run } = snap,
    config = json(run.config),
    options = json(run.options);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [run.id]);
    const prior = await client.query(
      "SELECT id,delivered_at FROM import_receipts WHERE run_id=$1 AND digest=$2",
      [run.id, snap.digest],
    );
    if (prior.rows.length) {
      await client.query("COMMIT");
      return {
        receiptId: Number(prior.rows[0].id),
        duplicate: true,
        inserted: {},
      };
    }
    await client.query(
      "INSERT INTO sources(id) VALUES($1) ON CONFLICT DO NOTHING",
      [run.source_key],
    );
    await client.query(
      `INSERT INTO collections(id,source_id,url,latest_revision) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET url=excluded.url, latest_revision=excluded.latest_revision,
         source_id=excluded.source_id, updated_at=now()`,
      [run.collection_id, run.source_key, config.url, run.revision],
    );
    await client.query(
      `INSERT INTO collection_revisions(collection_id,revision,config) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [run.collection_id, run.revision, jsonText(run.config)],
    );
    const runRow = await client.query(
      `INSERT INTO extraction_runs(id,collection_id,config_revision,source_key,status,options,build_id,
         result,error,expected_total,requests,active_ms,created_at,journal_updated_at,origin)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=excluded.result,error=excluded.error,
         expected_total=excluded.expected_total,requests=excluded.requests,active_ms=excluded.active_ms,
         journal_updated_at=excluded.journal_updated_at,last_delivered_at=now()
       WHERE extraction_runs.journal_updated_at <= excluded.journal_updated_at
       RETURNING id`,
      [
        run.id,
        run.collection_id,
        run.revision,
        run.source_key,
        run.status,
        jsonText(run.options),
        options?.buildId ?? null,
        jsonText(run.result),
        jsonText(run.error),
        run.expected_total,
        run.requests,
        run.active_ms,
        ts(run.created),
        ts(run.updated),
        JSON.stringify(origin),
      ],
    );
    if (!runRow.rows.length) {
      const live = await client.query(
        "SELECT collection_id,config_revision FROM extraction_runs WHERE id=$1",
        [run.id],
      );
      if (
        live.rows[0]?.collection_id !== run.collection_id ||
        live.rows[0]?.config_revision !== run.revision
      )
        throw Object.assign(new Error(`Run ${run.id} identity conflict`), {
          code: "run_conflict",
        });
      throw Object.assign(
        new Error(
          `Run ${run.id} in the database is newer than this journal snapshot`,
        ),
        { code: "stale_snapshot" },
      );
    }
    await insertRows(
      client,
      "extraction_attempts",
      [
        "id",
        "run_id",
        "number",
        "started_at",
        "finished_at",
        "outcome",
        "error",
      ],
      snap.attempts.map((a) => [
        a.id,
        run.id,
        a.number,
        ts(a.started),
        ts(a.finished),
        a.outcome,
        jsonText(a.error),
      ]),
      "ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at,outcome=excluded.outcome,error=excluded.error",
    );
    // Evidence: one row per distinct capture hash, bytes stored when the local
    // file still exists and hashes to the recorded value.
    const evidenceRows = [],
      seen = new Set(),
      evidenceStats = { objects: 0, withContent: 0, missing: 0, mismatched: 0 };
    for (const p of snap.pages) {
      if (!p.content_hash || seen.has(p.content_hash)) continue;
      seen.add(p.content_hash);
      let size = null,
        content = null;
      if (p.capture && existsSync(p.capture)) {
        size = statSync(p.capture).size;
        if (evidence) {
          const body = readFileSync(p.capture);
          if (
            createHash("sha256").update(body).digest("hex") === p.content_hash
          )
            content = gzipSync(body);
          else evidenceStats.mismatched++;
        }
      } else evidenceStats.missing++;
      if (content) evidenceStats.withContent++;
      evidenceStats.objects++;
      evidenceRows.push([p.content_hash, size, p.capture, content]);
    }
    await insertRows(
      client,
      "evidence_objects",
      ["content_hash", "byte_size", "local_path", "content_gzip"],
      evidenceRows,
      "ON CONFLICT(content_hash) DO UPDATE SET content_gzip=coalesce(evidence_objects.content_gzip,excluded.content_gzip)," +
        "byte_size=coalesce(evidence_objects.byte_size,excluded.byte_size)",
    );
    await insertRows(
      client,
      "run_pages",
      [
        "run_id",
        "page_id",
        "url",
        "kind",
        "depth",
        "state",
        "tries",
        "meta",
        "content_hash",
        "fingerprint",
        "result",
        "error",
      ],
      snap.pages.map((p) => [
        run.id,
        p.id,
        p.url,
        p.kind,
        p.depth,
        p.state,
        p.tries,
        jsonText(p.meta) ?? "{}",
        p.content_hash,
        p.fingerprint,
        jsonText(p.result),
        jsonText(p.error),
      ]),
      `ON CONFLICT(run_id,page_id) DO UPDATE SET state=excluded.state,tries=excluded.tries,
        content_hash=excluded.content_hash,fingerprint=excluded.fingerprint,result=excluded.result,error=excluded.error`,
    );
    const obs = snap.observations.map((o) => {
      const p = JSON.parse(o.payload);
      return {
        record_key: o.record_key,
        payload_hash: hash(o.payload),
        row: [
          run.id,
          o.record_key,
          o.page_id,
          o.payload,
          hash(o.payload),
          run.collection_id,
          text(p.title),
          text(p.url),
          isoDate(p.startDate),
          isoDate(p.endDate),
          text(p.startLocal),
          text(p.endLocal),
          text(p.timeZone),
          text(p.marketCity),
        ],
      };
    });
    const inserted = {};
    inserted.observations = await insertRows(
      client,
      "source_observations",
      [
        "run_id",
        "record_key",
        "page_id",
        "payload",
        "payload_hash",
        "collection_id",
        "title",
        "event_url",
        "start_date",
        "end_date",
        "start_local",
        "end_local",
        "time_zone",
        "market_city",
      ],
      obs.map((o) => o.row),
      "ON CONFLICT DO NOTHING",
    );
    await assertSamePayloads(
      client,
      "source_observations",
      ["record_key"],
      obs,
      run.id,
    );
    const enr = snap.enrichments.map((e) => ({
      record_key: e.record_key,
      page_id: e.page_id,
      payload_hash: hash(e.payload),
      row: [run.id, e.record_key, e.page_id, e.payload, hash(e.payload)],
    }));
    inserted.enrichments = await insertRows(
      client,
      "observation_enrichments",
      ["run_id", "record_key", "page_id", "payload", "payload_hash"],
      enr.map((e) => e.row),
      "ON CONFLICT DO NOTHING",
    );
    await assertSamePayloads(
      client,
      "observation_enrichments",
      ["record_key", "page_id"],
      enr,
      run.id,
    );
    const exp = snap.expansions.map((e) => ({
      parent_key: e.parent_key,
      record_key: e.record_key,
      page_id: e.page_id,
      payload_hash: hash(e.payload),
      row: [
        run.id,
        e.parent_key,
        e.record_key,
        e.page_id,
        e.payload,
        hash(e.payload),
      ],
    }));
    inserted.expansions = await insertRows(
      client,
      "observation_expansions",
      [
        "run_id",
        "parent_key",
        "record_key",
        "page_id",
        "payload",
        "payload_hash",
      ],
      exp.map((e) => e.row),
      "ON CONFLICT DO NOTHING",
    );
    await assertSamePayloads(
      client,
      "observation_expansions",
      ["parent_key", "record_key", "page_id"],
      exp,
      run.id,
    );
    const receipt = await client.query(
      `INSERT INTO import_receipts(run_id,digest,run_status,counts) VALUES($1,$2,$3,$4)
       RETURNING id`,
      [
        run.id,
        snap.digest,
        run.status,
        JSON.stringify({ ...snap.counts, evidence: evidenceStats }),
      ],
    );
    await client.query("COMMIT");
    return {
      receiptId: Number(receipt.rows[0].id),
      duplicate: false,
      inserted,
      evidence: evidenceStats,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

// Compare a delivered run with its journal snapshot.
export async function verifyRun(client, snap) {
  const id = snap.run.id;
  const q = async (sql, params = [id]) =>
    Number((await client.query(sql, params)).rows[0].n);
  const db = {
    pages: await q("SELECT count(*) n FROM run_pages WHERE run_id=$1"),
    observations: await q(
      "SELECT count(*) n FROM source_observations WHERE run_id=$1",
    ),
    enrichments: await q(
      "SELECT count(*) n FROM observation_enrichments WHERE run_id=$1",
    ),
    expansions: await q(
      "SELECT count(*) n FROM observation_expansions WHERE run_id=$1",
    ),
    attempts: await q(
      "SELECT count(*) n FROM extraction_attempts WHERE run_id=$1",
    ),
    pagesMissingEvidence: await q(
      "SELECT count(*) n FROM run_pages p WHERE run_id=$1 AND content_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence_objects e WHERE e.content_hash=p.content_hash)",
    ),
    receipt: await q(
      "SELECT count(*) n FROM import_receipts WHERE run_id=$1 AND digest=$2",
      [id, snap.digest],
    ),
  };
  const matches =
    db.pages === snap.counts.pages &&
    db.observations === snap.counts.observations &&
    db.enrichments === snap.counts.enrichments &&
    db.expansions === snap.counts.expansions &&
    db.attempts === snap.counts.attempts &&
    db.pagesMissingEvidence === 0 &&
    db.receipt === 1;
  return { runId: id, matches, journal: snap.counts, database: db };
}

export const originFor = (label) => ({ journal: label, host: hostname() });
