import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hash } from "./journal.mjs";

// Local delivery state, kept beside a journal but in its own file so delivery
// never migrates or writes the crawler journal. Keyed by target database, run
// and run-state digest: a receipt for one database never suppresses another.
export class Outbox {
  constructor(path, clock = Date.now) {
    mkdirSync(dirname(path), { recursive: true });
    this.clock = clock;
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS deliveries(target TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('delivered','failed')), receipt_id INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, counts TEXT, updated INTEGER NOT NULL,
        PRIMARY KEY(target, run_id, digest));`);
  }
  close() {
    this.db.close();
  }
  delivered(target, runId, digest) {
    return this.db
      .prepare(
        "SELECT receipt_id FROM deliveries WHERE target=? AND run_id=? AND digest=? AND status='delivered'",
      )
      .get(target, runId, digest);
  }
  record(
    target,
    runId,
    digest,
    { receiptId = null, error = null, counts = null },
  ) {
    this.db
      .prepare(
        `INSERT INTO deliveries(target,run_id,digest,status,receipt_id,attempts,last_error,counts,updated)
        VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(target,run_id,digest) DO UPDATE SET
        status=CASE WHEN deliveries.status='delivered' THEN 'delivered' ELSE excluded.status END,
        receipt_id=coalesce(excluded.receipt_id,deliveries.receipt_id), attempts=deliveries.attempts+1,
        last_error=excluded.last_error, counts=coalesce(excluded.counts,deliveries.counts), updated=excluded.updated`,
      )
      .run(
        target,
        runId,
        digest,
        error ? "failed" : "delivered",
        receiptId,
        error,
        counts ? JSON.stringify(counts) : null,
        this.clock(),
      );
  }
  summary(target) {
    return this.db
      .prepare(
        "SELECT status, count(*) n FROM deliveries WHERE target=? GROUP BY status",
      )
      .all(target);
  }
}

// Non-secret target identity: host, port and database name only.
export function targetId(connectionString) {
  const u = new URL(connectionString);
  return hash(`${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`).slice(
    0,
    16,
  );
}
