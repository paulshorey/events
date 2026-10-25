import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export class LeaseLost extends Error {
  constructor() {
    super("Run ownership expired or was replaced");
    this.code = "lease_lost";
  }
}
export class Journal {
  constructor(
    path = ".artifacts/framework/journal.sqlite",
    clock = Date.now,
    { readOnly = false } = {},
  ) {
    if (!readOnly && path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true });
    this.clock = clock;
    this.db = new DatabaseSync(path, { timeout: 5000, readOnly });
    if (readOnly) {
      this.hasEnrichments = !!this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='record_enrichments'",
        )
        .get();
      this.hasExpansions = !!this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='record_expansions'",
        )
        .get();
      return;
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, config TEXT NOT NULL, revision TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'onboarding', next_due INTEGER NOT NULL DEFAULT 0,
        last_attempt TEXT,last_good TEXT,last_complete TEXT,failure_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL REFERENCES collections(id),
        source_key TEXT NOT NULL,config TEXT NOT NULL,revision TEXT NOT NULL,options TEXT NOT NULL,status TEXT NOT NULL,
        created INTEGER NOT NULL,updated INTEGER NOT NULL,not_before INTEGER NOT NULL DEFAULT 0,
        owner TEXT,token TEXT,lease_until INTEGER,attempt_no INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0,
        active_ms INTEGER NOT NULL DEFAULT 0,expected_total INTEGER,result TEXT,error TEXT,slot TEXT UNIQUE);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_collection ON runs(collection_id) WHERE status IN ('queued','running','retry_wait');
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),number INTEGER,
        owner TEXT,token TEXT,started INTEGER,finished INTEGER,outcome TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS source_leases(source_key TEXT PRIMARY KEY,run_id TEXT,token TEXT,lease_until INTEGER);
      CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,next_allowed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),url TEXT NOT NULL,
        kind TEXT NOT NULL,depth INTEGER NOT NULL DEFAULT 0,meta TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT 'pending',
        tries INTEGER NOT NULL DEFAULT 0,capture TEXT,content_hash TEXT,fingerprint TEXT,result TEXT,error TEXT,
        UNIQUE(run_id,url,kind));
      CREATE TABLE IF NOT EXISTS observations(run_id TEXT NOT NULL REFERENCES runs(id),record_key TEXT NOT NULL,
        payload TEXT NOT NULL,page_id INTEGER NOT NULL REFERENCES pages(id),PRIMARY KEY(run_id,record_key));
      CREATE TABLE IF NOT EXISTS record_enrichments(run_id TEXT NOT NULL,record_key TEXT NOT NULL,
        page_id INTEGER NOT NULL REFERENCES pages(id),payload TEXT NOT NULL,
        PRIMARY KEY(run_id,record_key,page_id),
        FOREIGN KEY(run_id,record_key) REFERENCES observations(run_id,record_key));
      CREATE TABLE IF NOT EXISTS record_expansions(run_id TEXT NOT NULL,parent_key TEXT NOT NULL,record_key TEXT NOT NULL,page_id INTEGER NOT NULL REFERENCES pages(id),payload TEXT NOT NULL,
        PRIMARY KEY(run_id,parent_key,record_key,page_id), FOREIGN KEY(run_id,parent_key) REFERENCES observations(run_id,record_key));
      CREATE TABLE IF NOT EXISTS repair_jobs(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL,run_id TEXT NOT NULL,
        code TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created INTEGER,updated INTEGER,occurrences INTEGER DEFAULT 1,
        packet TEXT NOT NULL,owner TEXT,token TEXT,lease_until INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_repair ON repair_jobs(collection_id,code) WHERE status IN ('open','claimed','probation');
      CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,run_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL);
      PRAGMA user_version=3;`);
    this.hasEnrichments = true;
    this.hasExpansions = true;
  }
  close() {
    this.db.close();
  }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  action(runId, kind, payload) {
    this.db
      .prepare("INSERT INTO actions(at,run_id,kind,payload) VALUES(?,?,?,?)")
      .run(this.clock(), runId, kind, JSON.stringify(payload));
  }
  register(configs) {
    return this.tx(() => {
      for (const c of configs) {
        const revision = hash(c);
        this.db
          .prepare(
            `INSERT INTO collections(id,config,revision) VALUES(?,?,?)
        ON CONFLICT(id) DO UPDATE SET config=excluded.config,revision=excluded.revision`,
          )
          .run(c.id, JSON.stringify(c), revision);
      }
      return configs.length;
    });
  }
  collection(id) {
    const row = this.db.prepare("SELECT * FROM collections WHERE id=?").get(id);
    return row ? { ...row, config: JSON.parse(row.config) } : null;
  }
  list() {
    return this.db
      .prepare("SELECT * FROM collections ORDER BY id")
      .all()
      .map((r) => ({ ...r, config: JSON.parse(r.config) }));
  }
  configure(id, enabled) {
    if (!this.collection(id)) throw new Error(`Unknown collection ${id}`);
    this.db
      .prepare("UPDATE collections SET enabled=? WHERE id=?")
      .run(Number(enabled), id);
  }
  enqueue(id, options = {}, slot = null) {
    return this.tx(() => this._enqueue(id, options, slot));
  }
  _enqueue(id, options, slot) {
    const c = this.collection(id);
    if (!c) throw new Error(`Unknown collection ${id}`);
    const existing = this.db
      .prepare(
        "SELECT id FROM runs WHERE collection_id=? AND status IN ('queued','running','retry_wait')",
      )
      .get(id);
    if (existing) return { runId: existing.id, created: false };
    if (slot) {
      const found = this.db
        .prepare("SELECT id FROM runs WHERE slot=?")
        .get(slot);
      if (found) return { runId: found.id, created: false };
    }
    const runId = randomUUID(),
      now = this.clock();
    this.db
      .prepare(
        `INSERT INTO runs(id,collection_id,source_key,config,revision,options,status,created,updated,slot)
      VALUES(?,?,?,?,?,?,'queued',?,?,?)`,
      )
      .run(
        runId,
        id,
        c.config.rateKey ?? new URL(c.config.url).hostname,
        JSON.stringify(c.config),
        c.revision,
        JSON.stringify(options),
        now,
        now,
        slot,
      );
    if (options.transport === "api") {
      if (!c.config.apiEndpoint)
        throw new Error(
          "This collection has no verified API endpoint configuration",
        );
      const url = new URL(c.config.apiEndpoint);
      url.search = new URLSearchParams({
        per_page: String(options.perPage ?? 50),
        page: "1",
        start_date: options.asOf,
      });
      this._addPage(runId, { url: url.href, kind: "api", depth: 0 });
    } else
      for (const seed of c.config.entrypoints ?? [c.config.url])
        this._addPage(
          runId,
          typeof seed === "string"
            ? { url: seed, kind: "listing", depth: 0 }
            : seed,
        );
    this.action(runId, "enqueued", { id, options, slot });
    return { runId, created: true };
  }
  schedule(options = {}) {
    return this.tx(() => {
      const now = this.clock(),
        out = [];
      for (const c of this.list().filter(
        (c) =>
          c.enabled &&
          c.next_due <= now &&
          ![
            "repair_needed",
            "blocked_access",
            "needs_validation",
            "probation",
          ].includes(c.health),
      )) {
        if (
          this.repairs().some(
            (r) => r.collection_id === c.id && r.status !== "closed",
          )
        )
          continue;
        const interval = c.config.intervalHours * 3600000,
          slot = `${c.id}:${Math.floor(now / interval)}`;
        out.push(
          this._enqueue(
            c.id,
            typeof options === "function" ? options(c.config) : options,
            slot,
          ),
        );
        this.db
          .prepare("UPDATE collections SET next_due=? WHERE id=?")
          .run(now + interval, c.id);
      }
      return out;
    });
  }
  recover() {
    return this.tx(() => {
      const expired = this.db
        .prepare("SELECT * FROM runs WHERE status='running' AND lease_until<=?")
        .all(this.clock());
      for (const r of expired) {
        const started =
          this.db
            .prepare("SELECT started FROM attempts WHERE run_id=? AND token=?")
            .get(r.id, r.token)?.started ?? r.updated;
        this.db
          .prepare(
            "UPDATE attempts SET finished=?,outcome='interrupted' WHERE run_id=? AND token=? AND finished IS NULL",
          )
          .run(this.clock(), r.id, r.token);
        this.db
          .prepare(
            "UPDATE pages SET state='pending' WHERE run_id=? AND state='processing'",
          )
          .run(r.id);
        this.db
          .prepare(
            "UPDATE runs SET status='queued',owner=NULL,token=NULL,lease_until=NULL,updated=?,active_ms=active_ms+? WHERE id=?",
          )
          .run(this.clock(), Math.max(0, this.clock() - started), r.id);
        this.db
          .prepare("DELETE FROM source_leases WHERE run_id=? AND token=?")
          .run(r.id, r.token);
        this.action(r.id, "lease_recovered", {
          previousOwner: r.owner,
          previousToken: r.token,
        });
      }
      this.db
        .prepare(
          "UPDATE repair_jobs SET status='open',owner=NULL,token=NULL,lease_until=NULL WHERE status='claimed' AND lease_until<=?",
        )
        .run(this.clock());
      return expired.map((r) => r.id);
    });
  }
  claim(owner, leaseMs = 60000, runId = null) {
    return this.tx(() => {
      const now = this.clock();
      const candidates = this.db
        .prepare(
          `SELECT * FROM runs WHERE status IN ('queued','retry_wait') AND not_before<=? ${runId ? "AND id=?" : ""} ORDER BY created`,
        )
        .all(...(runId ? [now, runId] : [now]));
      for (const r of candidates) {
        const source = this.db
          .prepare("SELECT * FROM source_leases WHERE source_key=?")
          .get(r.source_key);
        if (source && source.lease_until > now) continue;
        const token = randomUUID(),
          attemptId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO source_leases VALUES(?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET run_id=excluded.run_id,token=excluded.token,lease_until=excluded.lease_until`,
          )
          .run(r.source_key, r.id, token, now + leaseMs);
        this.db
          .prepare(
            "UPDATE runs SET status='running',owner=?,token=?,lease_until=?,attempt_no=attempt_no+1,updated=? WHERE id=?",
          )
          .run(owner, token, now + leaseMs, now, r.id);
        this.db
          .prepare(
            "INSERT INTO attempts(id,run_id,number,owner,token,started) VALUES(?,?,?,?,?,?)",
          )
          .run(attemptId, r.id, r.attempt_no + 1, owner, token, now);
        return { ...this.run(r.id), attemptId, token, owner };
      }
      return null;
    });
  }
  run(id) {
    const r = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id);
    return r
      ? {
          ...r,
          config: JSON.parse(r.config),
          options: JSON.parse(r.options),
          result: r.result ? JSON.parse(r.result) : null,
          error: r.error ? JSON.parse(r.error) : null,
        }
      : null;
  }
  assertLease(id, token) {
    const r = this.db
      .prepare(
        "SELECT r.id FROM runs r JOIN source_leases s ON s.run_id=r.id AND s.token=r.token WHERE r.id=? AND r.token=? AND r.status='running' AND r.lease_until>? AND s.lease_until>?",
      )
      .get(id, token, this.clock(), this.clock());
    if (!r) throw new LeaseLost();
  }
  heartbeat(id, token, leaseMs = 60000) {
    return this.tx(() => {
      this.assertLease(id, token);
      const until = this.clock() + leaseMs;
      this.db
        .prepare(
          "UPDATE runs SET lease_until=?,updated=? WHERE id=? AND token=?",
        )
        .run(until, this.clock(), id, token);
      this.db
        .prepare(
          "UPDATE source_leases SET lease_until=? WHERE run_id=? AND token=?",
        )
        .run(until, id, token);
    });
  }
  deferRate(key, delay) {
    if (!Number.isFinite(delay) || delay < 0)
      throw new Error("Invalid publisher cooldown");
    this.db
      .prepare(
        "INSERT INTO rate_limits(key,next_allowed) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET next_allowed=MAX(next_allowed,excluded.next_allowed)",
      )
      .run(key, this.clock() + delay);
  }
  reserveRate(key, intervalMs = 1000) {
    return this.tx(() => {
      const now = this.clock(),
        old = this.db
          .prepare("SELECT next_allowed FROM rate_limits WHERE key=?")
          .get(key);
      const when = Math.max(now, old?.next_allowed ?? 0);
      this.db
        .prepare(
          "INSERT INTO rate_limits VALUES(?,?) ON CONFLICT(key) DO UPDATE SET next_allowed=excluded.next_allowed",
        )
        .run(key, when + intervalMs);
      return Math.max(0, when - now);
    });
  }
  _addPage(id, page) {
    if (
      typeof page.url !== "string" ||
      !["https:", "http:"].includes(new URL(page.url).protocol)
    )
      throw new Error("Invalid queued page URL");
    const existing = this.db
      .prepare(
        "SELECT id,state,meta FROM pages WHERE run_id=? AND url=? AND kind=?",
      )
      .get(id, page.url, page.kind ?? "listing");
    if (existing && page.meta?.enrichRecordIds?.length) {
      const meta = JSON.parse(existing.meta),
        ids = new Set(meta.enrichRecordIds ?? []);
      const additions = page.meta.enrichRecordIds.filter(
        (key) => !ids.has(key),
      );
      if (additions.length && existing.state !== "pending")
        throw Object.assign(
          new Error(
            "New occurrence bindings arrived after the detail task was claimed; start a fresh enumeration",
          ),
          { code: "late_detail_bindings" },
        );
      for (const key of additions) ids.add(key);
      if (additions.length)
        this.db
          .prepare("UPDATE pages SET meta=? WHERE id=?")
          .run(
            JSON.stringify({ ...meta, enrichRecordIds: [...ids] }),
            existing.id,
          );
    }
    return this.db
      .prepare(
        "INSERT INTO pages(run_id,url,kind,depth,meta) VALUES(?,?,?,?,?) ON CONFLICT(run_id,url,kind) DO NOTHING",
      )
      .run(
        id,
        page.url,
        page.kind ?? "listing",
        page.depth ?? 0,
        JSON.stringify(page.meta ?? {}),
      );
  }
  nextPage(id, token) {
    return this.tx(() => {
      this.assertLease(id, token);
      const p = this.db
        .prepare(
          "SELECT * FROM pages WHERE run_id=? AND state='pending' ORDER BY CASE WHEN kind IN ('listing','api') THEN 0 ELSE 1 END,id LIMIT 1",
        )
        .get(id);
      if (!p) return null;
      this.db
        .prepare("UPDATE pages SET state='processing',tries=tries+1 WHERE id=?")
        .run(p.id);
      this.db.prepare("UPDATE runs SET requests=requests+1 WHERE id=?").run(id);
      return { ...p, meta: JSON.parse(p.meta) };
    });
  }
  commitPage(id, token, page, result, capture) {
    return this.tx(() => {
      this.assertLease(id, token);
      const owned = this.db
        .prepare(
          "SELECT id FROM pages WHERE id=? AND run_id=? AND state='processing'",
        )
        .get(page.id, id);
      if (!owned) throw new Error("Page is not in flight under this run");
      const fp = hash(result.records.map((r) => r.sourceRecordId).sort());
      if (
        result.records.length &&
        page.meta.pagination &&
        this.db
          .prepare(
            "SELECT id FROM pages WHERE run_id=? AND state='done' AND fingerprint=? AND url<>?",
          )
          .get(id, fp, page.url)
      ) {
        const e = new Error(
          "Pagination repeated a previously extracted record set",
        );
        e.code = "pagination_changed";
        throw e;
      }
      if (result.expectedTotal != null) {
        const old = this.run(id).expected_total;
        if (old != null && old !== result.expectedTotal) {
          const e = new Error("Upstream total changed during enumeration");
          e.code = "enumeration_changed";
          throw e;
        }
        this.db
          .prepare("UPDATE runs SET expected_total=? WHERE id=?")
          .run(result.expectedTotal, id);
      }
      for (const record of result.records)
        this.db
          .prepare(
            "INSERT INTO observations(run_id,record_key,payload,page_id) VALUES(?,?,?,?) ON CONFLICT(run_id,record_key) DO NOTHING",
          )
          .run(id, record.sourceRecordId, JSON.stringify(record), page.id);
      for (const record of result.enrichments ?? []) {
        if (!page.meta.enrichRecordIds?.includes(record.sourceRecordId))
          throw new Error(
            "Detail enrichment is not bound to the requested listing record",
          );
        this.db
          .prepare(
            `INSERT INTO record_enrichments(run_id,record_key,page_id,payload)
          VALUES(?,?,?,?) ON CONFLICT(run_id,record_key,page_id) DO NOTHING`,
          )
          .run(id, record.sourceRecordId, page.id, JSON.stringify(record));
      }
      for (const expansion of result.expansions ?? []) {
        if (
          !page.meta.enrichRecordIds?.includes(expansion.parentRecordId) ||
          expansion.records.length < 2 ||
          new Set(expansion.records.map((r) => r.sourceRecordId)).size !==
            expansion.records.length
        )
          throw new Error("Invalid detail occurrence expansion binding");
        for (const record of expansion.records) {
          if (
            !record.sourceRecordId ||
            record.sourceRecordId === expansion.parentRecordId
          )
            throw new Error(
              "Expansion requires distinct occurrence identities",
            );
          this.db
            .prepare(
              "INSERT INTO record_expansions(run_id,parent_key,record_key,page_id,payload) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
            )
            .run(
              id,
              expansion.parentRecordId,
              record.sourceRecordId,
              page.id,
              JSON.stringify(record),
            );
        }
      }
      for (const next of result.nextRequests) this._addPage(id, next);
      this.db
        .prepare(
          "UPDATE pages SET state='done',capture=?,content_hash=?,fingerprint=?,result=? WHERE id=?",
        )
        .run(
          capture.path,
          capture.hash,
          fp,
          JSON.stringify({
            ...result,
            records: undefined,
            enrichments: undefined,
            expansions: undefined,
          }),
          page.id,
        );
    });
  }
  pages(id) {
    return this.db
      .prepare("SELECT * FROM pages WHERE run_id=? ORDER BY id")
      .all(id)
      .map((p) => ({
        ...p,
        meta: JSON.parse(p.meta),
        result: p.result ? JSON.parse(p.result) : null,
        error: p.error ? JSON.parse(p.error) : null,
      }));
  }
  records(id) {
    const records = this.db
      .prepare(
        "SELECT payload FROM observations WHERE run_id=? ORDER BY record_key",
      )
      .all(id)
      .map((r) => JSON.parse(r.payload));
    if (!this.hasEnrichments) return records;
    const enriched = new Map(
      this.db
        .prepare(
          "SELECT record_key,payload FROM record_enrichments WHERE run_id=? ORDER BY page_id",
        )
        .all(id)
        .map((r) => [r.record_key, JSON.parse(r.payload)]),
    );
    const expanded = new Map();
    if (this.hasExpansions)
      for (const row of this.db
        .prepare(
          "SELECT parent_key,record_key,payload FROM record_expansions WHERE run_id=? ORDER BY page_id",
        )
        .all(id)) {
        if (!expanded.has(row.parent_key))
          expanded.set(row.parent_key, new Map());
        expanded
          .get(row.parent_key)
          .set(row.record_key, JSON.parse(row.payload));
      }
    return records.flatMap((r) =>
      expanded.has(r.sourceRecordId)
        ? [...expanded.get(r.sourceRecordId).values()]
        : [enriched.get(r.sourceRecordId) ?? r],
    );
  }
  pageError(id, token, pageId, error, retry, capture = null) {
    return this.tx(() => {
      this.assertLease(id, token);
      this.db
        .prepare(
          "UPDATE pages SET state=?,error=?,capture=COALESCE(?,capture) WHERE id=? AND run_id=?",
        )
        .run(
          retry ? "pending" : "failed",
          JSON.stringify(error),
          capture?.path ?? null,
          pageId,
          id,
        );
    });
  }
  finish(id, token, status, result, error = null, elapsed = 0) {
    return this.tx(() => {
      this.assertLease(id, token);
      const r = this.run(id),
        now = this.clock();
      this.db
        .prepare(
          "UPDATE runs SET status=?,result=?,error=?,owner=NULL,token=NULL,lease_until=NULL,active_ms=active_ms+?,updated=?,not_before=? WHERE id=?",
        )
        .run(
          status,
          JSON.stringify(result),
          error ? JSON.stringify(error) : null,
          elapsed,
          now,
          status === "retry_wait"
            ? now +
                (error?.retryAfterMs ??
                  Math.min(3600000, 30000 * 2 ** Math.min(r.attempt_no, 6)))
            : 0,
          id,
        );
      this.db
        .prepare(
          "UPDATE attempts SET outcome=?,error=?,finished=? WHERE run_id=? AND token=? AND finished IS NULL",
        )
        .run(status, error ? JSON.stringify(error) : null, now, id, token);
      this.db
        .prepare("DELETE FROM source_leases WHERE run_id=? AND token=?")
        .run(id, token);
      const health =
        status === "complete"
          ? "healthy"
          : status === "repair_needed"
            ? "repair_needed"
            : status === "blocked_access"
              ? "blocked_access"
              : status === "partial"
                ? "needs_validation"
                : status;
      this.db
        .prepare(
          "UPDATE collections SET health=?,last_attempt=?,last_good=CASE WHEN ? THEN ? ELSE last_good END,last_complete=CASE WHEN ? THEN ? ELSE last_complete END,failure_count=CASE WHEN ? THEN 0 ELSE failure_count+1 END WHERE id=?",
        )
        .run(
          health,
          id,
          Number(
            ["complete", "partial"].includes(status) &&
              result.recordCount > 0 &&
              !result.issues?.length,
          ),
          id,
          Number(status === "complete"),
          id,
          Number(status === "complete"),
          r.collection_id,
        );
      if (["repair_needed", "blocked_access", "partial"].includes(status))
        this._repair(
          r,
          status,
          error ?? {
            code: "coverage_unverified",
            message: result.stopReason ?? "Enumeration needs validation",
          },
          result,
        );
      this.action(id, "finished", { status, error });
    });
  }
  _repair(run, status, error, result) {
    const now = this.clock(),
      code = error.code ?? status,
      packet = {
        runId: run.id,
        collectionId: run.collection_id,
        adapter: run.config.adapter,
        revision: run.revision,
        error,
        result,
        reproduce: `npm run framework -- run ${run.collection_id} --max-pages 2`,
        pages: this.pages(run.id).map((p) => ({
          id: p.id,
          url: p.url,
          state: p.state,
          error: p.error,
          capture: p.capture,
          result: p.result,
        })),
      };
    const existing = this.db
      .prepare(
        "SELECT id,status FROM repair_jobs WHERE collection_id=? AND code=? AND status IN ('open','claimed','probation')",
      )
      .get(run.collection_id, code);
    if (existing)
      this.db
        .prepare(
          "UPDATE repair_jobs SET run_id=?,updated=?,occurrences=occurrences+1,packet=?,status=CASE WHEN status='probation' THEN 'open' ELSE status END WHERE id=?",
        )
        .run(run.id, now, JSON.stringify(packet), existing.id);
    else
      this.db
        .prepare(
          "INSERT INTO repair_jobs(id,collection_id,run_id,code,status,created,updated,packet) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          run.collection_id,
          run.id,
          code,
          "open",
          now,
          now,
          JSON.stringify(packet),
        );
  }
  resume(id, options = {}) {
    return this.tx(() => {
      const r = this.run(id);
      if (!r) throw new Error("Unknown run");
      if (!["partial", "cancelled"].includes(r.status))
        throw new Error(
          "Only partial/cancelled runs can resume; repair failures require a fresh run",
        );
      if (this.collection(r.collection_id).revision !== r.revision)
        throw new Error(
          "Configuration changed; start a new run instead of changing this run scope",
        );
      const active = this.db
        .prepare(
          "SELECT id FROM runs WHERE collection_id=? AND status IN ('running','queued','retry_wait')",
        )
        .get(r.collection_id);
      if (active) throw new Error("Collection already has active work");
      const allowed = new Set([
        "maxPages",
        "maxRecords",
        "maxRuntimeMs",
        "maxRetries",
        "acceptCountChange",
      ]);
      if (Object.keys(options).some((key) => !allowed.has(key)))
        throw new Error(
          "Resume cannot change scope, transport, parser build or probe mode",
        );
      for (const key of [
        "maxPages",
        "maxRecords",
        "maxRuntimeMs",
        "maxRetries",
      ])
        if (
          options[key] != null &&
          (!Number.isSafeInteger(options[key]) || options[key] < r.options[key])
        )
          throw new Error("Resume budgets can only increase");
      const next = { ...r.options, ...options };
      this.db
        .prepare(
          "UPDATE runs SET status='queued',options=?,updated=? WHERE id=?",
        )
        .run(JSON.stringify(next), this.clock(), id);
      this.action(id, "resumed", { before: r.options, after: next });
      return id;
    });
  }
  cancel(id) {
    return this.tx(() => {
      const r = this.run(id);
      if (!r) throw new Error("Unknown run");
      if (["complete", "repair_needed", "blocked_access"].includes(r.status))
        throw new Error("Run is already terminal");
      this.db
        .prepare(
          "UPDATE runs SET status='cancelled',owner=NULL,token=NULL,lease_until=NULL,updated=? WHERE id=?",
        )
        .run(this.clock(), id);
      this.db.prepare("DELETE FROM source_leases WHERE run_id=?").run(id);
      this.db
        .prepare(
          "UPDATE attempts SET finished=?,outcome='cancelled' WHERE run_id=? AND finished IS NULL",
        )
        .run(this.clock(), id);
      this.db
        .prepare(
          "UPDATE pages SET state='pending' WHERE run_id=? AND state='processing'",
        )
        .run(id);
      this.action(id, "cancelled", {});
    });
  }
  repairs() {
    return this.db
      .prepare("SELECT * FROM repair_jobs ORDER BY updated DESC")
      .all()
      .map((r) => ({ ...r, packet: JSON.parse(r.packet) }));
  }
  claimRepair(id, owner, leaseMs = 1800000) {
    return this.tx(() => {
      const token = randomUUID(),
        now = this.clock();
      const updated = this.db
        .prepare(
          "UPDATE repair_jobs SET status='claimed',owner=?,token=?,lease_until=? WHERE id=? AND (status IN ('open','probation') OR (status='claimed' AND lease_until<=?)) RETURNING *",
        )
        .get(owner, token, now + leaseMs, id, now);
      if (!updated) throw new Error("Repair is already claimed or closed");
      return { ...updated, packet: JSON.parse(updated.packet) };
    });
  }
  probation(id, token, build) {
    return this.tx(() => {
      const repair = this.repairs().find((r) => r.id === id);
      if (
        !repair ||
        repair.status !== "claimed" ||
        repair.token !== token ||
        repair.lease_until <= this.clock()
      )
        throw new Error("Repair claim expired or replaced");
      const packet = {
        ...repair.packet,
        validation: {
          revision: this.collection(repair.collection_id).revision,
          build,
          after: this.clock(),
        },
      };
      this.db
        .prepare(
          "UPDATE repair_jobs SET status='probation',updated=?,packet=?,owner=NULL,token=NULL,lease_until=NULL WHERE id=?",
        )
        .run(this.clock(), JSON.stringify(packet), id);
      this.db
        .prepare("UPDATE collections SET health='probation' WHERE id=?")
        .run(repair.collection_id);
      this.action(repair.run_id, "repair_probation", {
        repairId: id,
        validation: packet.validation,
      });
      return packet.validation;
    });
  }
  resolveRepairs(build) {
    return this.tx(() => {
      const closed = [];
      for (const r of this.repairs().filter((r) => r.status === "probation")) {
        const v = r.packet.validation,
          c = this.collection(r.collection_id);
        if (!v || v.build !== build || v.revision !== c.revision) continue;
        const runs = this.db
          .prepare(
            "SELECT id,options FROM runs WHERE collection_id=? AND status='complete' AND revision=? AND created>=?",
          )
          .all(r.collection_id, v.revision, v.after)
          .filter((run) => JSON.parse(run.options).buildId === build);
        if (runs.length < 2 || this.run(c.last_attempt)?.status !== "complete")
          continue;
        this.db
          .prepare(
            "UPDATE repair_jobs SET status='closed',updated=? WHERE id=?",
          )
          .run(this.clock(), r.id);
        this.action(c.last_attempt, "repair_closed", {
          repairId: r.id,
          validationRuns: runs.map((run) => run.id),
        });
        closed.push(r.id);
      }
      return closed;
    });
  }
}
