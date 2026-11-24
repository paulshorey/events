// Read one delivered listing from dev and restore its evidence into a private cluster.
// Run from the checkout containing the dev .env.local. The archive is temporary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  connect,
  eventsDatabaseUrl,
  migrate,
} from "../src/storage/postgres.mjs";
import { disposableDatabase } from "../tests/helpers/postgres.mjs";

const runId = process.argv[2];
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId ?? ""))
  throw new Error("Pass a delivered complete run UUID");
if (process.env.EVENTS_TEST_PG_URL)
  throw new Error(
    "Unset EVENTS_TEST_PG_URL so the drill creates a private cluster",
  );

const sampleQuery = `
  SELECT to_jsonb(s) AS sources, to_jsonb(c) AS collections,
         to_jsonb(v) AS collection_revisions, to_jsonb(r) AS extraction_runs,
         to_jsonb(e) AS evidence_objects, to_jsonb(p) AS run_pages,
         to_jsonb(o) AS source_observations
  FROM extraction_runs r
  JOIN collections c ON c.id=r.collection_id
  JOIN sources s ON s.id=c.source_id
  JOIN collection_revisions v ON (v.collection_id,v.revision)=(r.collection_id,r.config_revision)
  JOIN source_observations o ON o.run_id=r.id
  JOIN run_pages p ON (p.run_id,p.page_id)=(o.run_id,o.page_id)
  JOIN evidence_objects e ON e.content_hash=p.content_hash
  WHERE r.id=$1 AND r.status='complete' AND p.error_capture_hash IS NULL
    AND e.content_gzip IS NOT NULL AND e.byte_size BETWEEN 1 AND 8388608
  ORDER BY o.record_key LIMIT 1`;
async function readSample(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const { rows } = await client.query(sampleQuery, [runId]);
    assert.equal(
      rows.length,
      1,
      "Run needs a listing with a capture up to 8 MiB",
    );
    return rows[0];
  } finally {
    await client.query("ROLLBACK");
  }
}
const remote = await connect(eventsDatabaseUrl({ local: true }));
let sample;
try {
  sample = await readSample(remote);
} finally {
  await remote.end();
}
const scratch = await mkdtemp(join(tmpdir(), "events-restore-"));
try {
  const stageUrl = await disposableDatabase();
  if (!stageUrl)
    throw new Error("PostgreSQL server tools are required (set PG_BIN)");
  const stage = await connect(stageUrl);
  try {
    await migrate(stage);
    await stage.query("BEGIN");
    for (const table of [
      "sources",
      "collections",
      "collection_revisions",
      "extraction_runs",
      "evidence_objects",
      "run_pages",
      "source_observations",
    ]) {
      await stage.query(
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`,
        [JSON.stringify(sample[table])],
      );
    }
    await stage.query("COMMIT");
  } finally {
    await stage.end();
  }
  const archive = join(scratch, "sample.dump");
  const pgTool = (name) =>
    process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
  execFileSync(pgTool("pg_dump"), [
    "--format=custom",
    "--file",
    archive,
    stageUrl,
  ]);
  const recoveredUrl = await disposableDatabase();
  execFileSync(pgTool("pg_restore"), [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--dbname",
    recoveredUrl,
    archive,
  ]);
  const target = await connect(recoveredUrl);
  try {
    const recovered = await readSample(target);
    assert.ok(
      isDeepStrictEqual(recovered, sample),
      "Restored rows differ from the dev snapshot",
    );
    const e = recovered.evidence_objects;
    const bytes = gunzipSync(Buffer.from(e.content_gzip.slice(2), "hex"), {
      maxOutputLength: 8388608,
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(bytes.length, Number(e.byte_size));
    assert.equal(sha256, recovered.run_pages.content_hash);
    console.log(
      JSON.stringify(
        {
          run: runId,
          collection: recovered.collections.id,
          page: recovered.run_pages.page_id,
          record: recovered.source_observations.record_key,
          restoredTables: Object.keys(recovered).length,
          bytes: bytes.length,
          sha256,
        },
        null,
        2,
      ),
    );
  } finally {
    await target.end();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
