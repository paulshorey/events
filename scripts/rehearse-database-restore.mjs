// Full logical application-data drill. All writes target a new local cluster.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { connect, eventsDatabaseUrl } from "../src/storage/postgres.mjs";
import pg from "pg";

const execute = promisify(execFile);
const pgTool = (name) =>
  process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
async function counts(client) {
  const { rows } = await client.query(
    "SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname='public' ORDER BY name",
  );
  const result = {};
  for (const { name } of rows)
    result[name] = Number(
      (await client.query("SELECT count(*) AS n FROM " + name)).rows[0].n,
    );
  return result;
}

async function verifyCaptures(client, signal) {
  // A server-side cursor keeps even a large capture collection out of the JS heap.
  await client.query("BEGIN READ ONLY");
  try {
    await client.query(
      "DECLARE captures NO SCROLL CURSOR FOR SELECT content_hash, byte_size, content_gzip FROM evidence_objects WHERE content_gzip IS NOT NULL",
    );
    let checked = 0;
    for (;;) {
      signal.throwIfAborted();
      const { rows } = await client.query("FETCH 16 FROM captures");
      if (!rows.length) return checked;
      for (const row of rows) {
        const bytes = gunzipSync(row.content_gzip);
        assert.equal(bytes.length, Number(row.byte_size));
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          row.content_hash,
        );
        checked++;
      }
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

const source = new URL(eventsDatabaseUrl({ local: true }));
const mode = source.searchParams.get("sslmode") ?? "require";
assert.ok(["require", "verify-full"].includes(mode), "Dev backup requires TLS");
const scratch = await mkdtemp(join(tmpdir(), "events-full-restore-"));
const data = join(scratch, "cluster");
const localUser = userInfo().username;
const localEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LC_ALL: "C",
};
let clusterStarted = false;
const archive = join(scratch, "events.dump");
const started = performance.now();
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
try {
  await execute(
    pgTool("initdb"),
    [
      "-D",
      data,
      "-U",
      localUser,
      "--auth-local=peer",
      "--auth-host=reject",
      "--encoding=UTF8",
    ],
    { env: localEnv },
  );
  // No TCP listener. Only this OS user can traverse the temporary directory.
  const socketDir = scratch.replaceAll("\\", "\\\\").replaceAll("'", "''");
  await appendFile(
    join(data, "postgresql.conf"),
    "\nlisten_addresses = ''\nunix_socket_directories = '" +
      socketDir +
      "'\nunix_socket_permissions = 0700\n",
  );
  await execute(
    pgTool("pg_ctl"),
    ["-D", data, "-w", "-l", join(scratch, "postgres.log"), "start"],
    { env: localEnv },
  );
  clusterStarted = true;
  const upstream = await connect(source.href);
  let original;
  try {
    await upstream.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await upstream.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    original = await counts(upstream);
    assert.ok(
      original["public.extraction_runs"] && original["public.evidence_objects"],
      "Expected a populated Events database",
    );

    await execute(
      pgTool("pg_dump"),
      [
        "--format=custom",
        "--compress=1",
        "--no-password",
        "--file",
        archive,
        "--snapshot",
        snapshot,
      ],
      {
        signal: cancellation.signal,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PGHOST: source.hostname,
          PGPORT: source.port || "5432",
          PGUSER: decodeURIComponent(source.username),
          PGPASSWORD: decodeURIComponent(source.password),
          PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
          PGSSLMODE: mode,
          PGOPTIONS: "-c default_transaction_read_only=on",
          PGCONNECT_TIMEOUT: "15",
        },
      },
    );
  } finally {
    await upstream.end();
  }
  const dumped = performance.now();
  cancellation.signal.throwIfAborted();

  await execute(
    pgTool("pg_restore"),
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "-h",
      scratch,
      "-p",
      "5432",
      "-U",
      localUser,
      "-d",
      "postgres",
      archive,
    ],
    { env: localEnv, signal: cancellation.signal },
  );
  const restored = performance.now();
  const local = new pg.Client({
    host: scratch,
    port: 5432,
    user: localUser,
    database: "postgres",
    ssl: false,
  });
  await local.connect();
  try {
    const tables = await counts(local);
    assert.deepEqual(tables, original);
    const verifiedCaptures = await verifyCaptures(local, cancellation.signal);
    console.log(
      JSON.stringify(
        {
          tables,
          verifiedCaptures,
          metadataOnly: tables["public.evidence_objects"] - verifiedCaptures,
          archiveBytes: (await stat(archive)).size,
          dumpSeconds: Math.round((dumped - started) / 1000),
          restoreSeconds: Math.round((restored - dumped) / 1000),
          checkSeconds: Math.round((performance.now() - restored) / 1000),
        },
        null,
        2,
      ),
    );
  } finally {
    await local.end();
  }
} finally {
  if (clusterStarted)
    await execute(pgTool("pg_ctl"), ["-D", data, "-w", "-m", "fast", "stop"], {
      env: localEnv,
    });
  await rm(scratch, { recursive: true, force: true });
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
