import { resolve, relative, join } from "node:path";
import { existsSync } from "node:fs";
import { Journal } from "./storage/journal.mjs";
import { Outbox, targetId } from "./storage/outbox.mjs";
import {
  TERMINAL,
  connect,
  migrate,
  snapshotRun,
  deliverSnapshot,
  verifyRun,
  originFor,
} from "./storage/postgres.mjs";

const PROJECT = resolve(new URL("..", import.meta.url).pathname);

// Deliver every terminal run in the given journal roots that the target has no
// receipt for. Collection never waits on this: a database outage leaves the
// journal untouched and the run pending in the outbox for a later retry.
export async function deliver({
  url,
  roots,
  runIds = null,
  dryRun = false,
  evidence = true,
  verify = true,
  applyMigrations = false,
  log = () => {},
}) {
  const target = targetId(url),
    report = { target, migrations: null, journals: [] };
  let client = null,
    receipts = null;
  const db = async () => {
    if (!client) {
      client = await connect(url);
      if (applyMigrations && !dryRun) report.migrations = await migrate(client);
    }
    return client;
  };
  try {
    // The database's receipts are authoritative: after a restore or
    // recreation at the same address, runs whose receipts are gone are
    // delivered again even though the local outbox recorded them.
    receipts = await remoteReceipts(await db());
    for (const root of roots) {
      const path = join(root, "journal.sqlite"),
        label = relative(PROJECT, root) || root,
        entry = {
          journal: label,
          delivered: 0,
          duplicates: 0,
          skipped: 0,
          failed: 0,
          runs: [],
        };
      report.journals.push(entry);
      if (!existsSync(path)) {
        entry.error = "journal not found";
        continue;
      }
      let journal, outbox;
      try {
        journal = new Journal(path, Date.now, { readOnly: true });
        outbox = new Outbox(join(root, "delivery.sqlite"));
        const rows = journal.db
          .prepare(
            `SELECT id,status FROM runs WHERE status IN (${TERMINAL.map(() => "?").join(",")}) ORDER BY created`,
          )
          .all(...TERMINAL)
          .filter((r) => !runIds || runIds.includes(r.id));
        for (const { id } of rows) {
          const snap = snapshotRun(journal, id);
          const base = {
            runId: id,
            collection: snap.run.collection_id,
            status: snap.run.status,
            counts: snap.counts,
          };
          const remote = receipts.get(`${id}:${snap.digest}`);
          if (remote != null) {
            if (!outbox.delivered(target, id, snap.digest))
              outbox.record(target, id, snap.digest, {
                receiptId: remote,
                counts: snap.counts,
              });
            entry.skipped++;
            continue;
          }
          if (outbox.delivered(target, id, snap.digest))
            entry.missingRemote = (entry.missingRemote ?? 0) + 1;
          if (dryRun) {
            entry.runs.push({ ...base, pending: true });
            continue;
          }
          try {
            const out = await deliverSnapshot(await db(), snap, {
              origin: originFor(label),
              evidence,
            });
            const check = verify ? await verifyRun(await db(), snap) : null;
            if (check && !check.matches)
              throw Object.assign(
                new Error("post-delivery verification mismatch"),
                { detail: check },
              );
            outbox.record(target, id, snap.digest, {
              receiptId: out.receiptId,
              counts: snap.counts,
            });
            out.duplicate ? entry.duplicates++ : entry.delivered++;
            entry.runs.push({
              ...base,
              receiptId: out.receiptId,
              duplicate: out.duplicate,
              evidence: out.evidence,
            });
            log({
              journal: label,
              ...base,
              receiptId: out.receiptId,
              duplicate: out.duplicate,
            });
          } catch (e) {
            const error = e.code ? `${e.code}: ${e.message}` : e.message;
            outbox.record(target, id, snap.digest, { error });
            entry.failed++;
            entry.runs.push({ ...base, error, detail: e.detail });
            log({ journal: label, ...base, error });
            // A lost connection fails every remaining run the same way.
            if (!client || isConnectionError(e))
              throw Object.assign(e, { report });
          }
        }
      } finally {
        journal?.close();
        outbox?.close();
      }
    }
  } catch (e) {
    throw Object.assign(e, { report });
  } finally {
    await client?.end().catch(() => {});
  }
  return report;
}

async function remoteReceipts(client) {
  try {
    const rows = (
      await client.query("SELECT id, run_id::text, digest FROM import_receipts")
    ).rows;
    return new Map(rows.map((r) => [`${r.run_id}:${r.digest}`, Number(r.id)]));
  } catch (e) {
    if (e.code === "42P01") return new Map(); // schema not migrated yet
    throw e;
  }
}

export function isConnectionError(e) {
  return (
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EPIPE",
      "57P01",
      "08006",
      "08001",
      "08003",
    ].includes(e?.code) ||
    /Connection terminated|timeout expired|connect ECONN|connect ETIMEDOUT/i.test(
      e?.message ?? "",
    )
  );
}
