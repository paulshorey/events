import { mkdir, writeFile, rename, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseDocument } from "./adapters/document.mjs";
import { parseTribePage } from "../examples/parsers.mjs";
import { validDate, eventRecord } from "./records.mjs";
import { fieldSummary, matchDetailBindings } from "./event-fields.mjs";
import { assessQuality } from "./quality.mjs";
import { Transport, sleep } from "./runtime/transport.mjs";
import { LeaseLost } from "./storage/journal.mjs";

export async function buildId() {
  const files = [
    "src/records.mjs",
    "src/event-fields.mjs",
    "src/quality.mjs",
    "src/worker.mjs",
    "src/runtime/transport.mjs",
    "src/storage/journal.mjs",
    "examples/parsers.mjs",
    "examples/runtime.mjs",
  ];
  for (const name of await readdir(new URL("adapters/", import.meta.url)))
    if (name.endsWith(".mjs")) files.push(`src/adapters/${name}`);
  const hash = createHash("sha256");
  for (const file of files.sort())
    hash
      .update(file)
      .update(await readFile(new URL(`../${file}`, import.meta.url)));
  return hash.digest("hex");
}
export function optionsFor(config, options, build) {
  const asOf =
    options.asOf ??
    new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone }).format(
      new Date(),
    );
  if (!validDate(asOf)) throw new Error("Invalid --as-of YYYY-MM-DD");
  const out = {
    asOf,
    maxPages: options.maxPages ?? 100,
    maxRecords: options.maxRecords ?? 10000,
    maxRuntimeMs: options.maxRuntimeMs ?? 180000,
    maxRetries: options.maxRetries ?? 3,
    probe: options.probe ?? false,
    transport: options.transport ?? config.defaultTransport ?? "browser",
    buildId: build,
    perPage: options.perPage ?? 50,
    acceptCountChange: options.acceptCountChange ?? null,
    diagnostics: options.diagnostics ?? false,
  };
  for (const k of [
    "maxPages",
    "maxRecords",
    "maxRuntimeMs",
    "maxRetries",
    "perPage",
  ])
    if (!Number.isSafeInteger(out[k]) || out[k] < 1)
      throw new Error(`Invalid ${k}`);
  if (out.perPage > 50) throw new Error("API page size must be <=50");
  if (!["browser", "api"].includes(out.transport))
    throw new Error("Unknown transport");
  return out;
}
export function parseApi(body, url, config, task) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  const parsed = parseTribePage(data),
    page = Number(new URL(url).searchParams.get("page") ?? 1),
    nextRequests = [];
  if (page < parsed.totalPages) {
    const next = new URL(url);
    next.searchParams.set("page", String(page + 1));
    nextRequests.push({
      url: next.href,
      kind: "api",
      depth: 0,
      meta: { pagination: true },
    });
  }
  return {
    records: parsed.records.map((r) => {
      const normalized = eventRecord(
        config,
        { ...r, id: r.sourceRecordId },
        { ...r.evidence, url },
      );
      if (!normalized)
        throw Object.assign(
          new Error("API event has invalid dates, times or location shape"),
          { code: "data_quality_error" },
        );
      return { ...normalized, validationStatus: "parser-validated" };
    }),
    nextRequests,
    expectedTotal: parsed.total,
    terminal: page >= parsed.totalPages,
    coverage: "api-query",
    method: "tec-rest",
    issues: [],
    rejected: 0,
    observedCount: parsed.records.length,
    scopeWarning:
      "API start_date filter; ongoing events starting earlier are outside this declared query",
  };
}
export function evaluate(journal, run, stopReason) {
  const pages = journal.pages(run.id),
    records = journal.records(run.id),
    pending = pages.filter(
      (p) => p.state === "pending" || p.state === "processing",
    ).length;
  const failed = pages.filter((p) => p.state === "failed").length,
    results = pages.filter((p) => p.state === "done").map((p) => p.result),
    issues = results.flatMap((p) => p.issues ?? []);
  const enumerationResults = pages
    .filter((p) => p.state === "done" && ["listing", "api"].includes(p.kind))
    .map((p) => p.result);
  const knownCoverage =
    enumerationResults.length > 0 &&
    enumerationResults.every((p) =>
      ["verified-list", "api-query"].includes(p.coverage),
    );
  const terminal = enumerationResults.some((p) => p.terminal),
    countMatches =
      run.expected_total == null || run.expected_total === records.length;
  const previousId = journal.collection(run.collection_id).last_complete;
  const previous =
    previousId && previousId !== run.id ? journal.run(previousId) : null;
  if (
    previous?.result?.observedRecords >= 10 &&
    records.length < previous.result.observedRecords * 0.5 &&
    !run.options.acceptCountChange
  )
    issues.push({
      code: "record_count_collapsed",
      previous: previous.result.observedRecords,
      current: records.length,
    });
  const enumerationComplete =
    !run.options.probe &&
    !stopReason &&
    !pending &&
    !failed &&
    knownCoverage &&
    terminal &&
    countMatches &&
    !issues.length &&
    records.length > 0;
  const quality = assessQuality(
    records,
    results,
    run.config.quality,
    previous?.options?.transport === run.options.transport
      ? previous?.result?.quality
      : null,
  );
  issues.push(...quality.failures);
  const complete = enumerationComplete && quality.status !== "failed";
  const upcoming = records.filter(
    (r) => (r.endDate ?? r.startDate) >= run.options.asOf,
  );
  return {
    outcome: complete ? "complete" : "partial",
    complete,
    enumeration: {
      complete: enumerationComplete,
      knownCoverage,
      terminal,
      countMatches,
    },
    quality,
    scope: {
      entrypoints: run.config.entrypoints ?? [run.config.url],
      asOf: run.options.asOf,
      transport: run.options.transport,
      basis:
        run.options.transport === "api"
          ? "all pages of the recorded start_date query"
          : "declared listing interface",
      validation:
        "core listing fields; not a guarantee of all events on the publisher domain",
    },
    pagesDone: results.length,
    pendingPages: pending,
    failedPages: failed,
    requests: run.requests,
    observedRecords: records.length,
    fieldQuality: fieldSummary(records),
    recordCount: upcoming.length,
    expectedTotal: run.expected_total,
    countMatches,
    issues,
    stopReason:
      stopReason ??
      (complete
        ? "enumeration_exhausted"
        : quality.status === "failed"
          ? "source_quality_failed"
          : run.options.probe
            ? "probe_only"
            : !knownCoverage
              ? "coverage_unverified"
              : !countMatches
                ? "count_mismatch"
                : "enumeration_unverified"),
  };
}
export async function exportRun(journal, id, root) {
  const run = journal.run(id);
  if (!run) throw new Error("Unknown run");
  if (run.status === "running")
    throw new Error("Cannot export an active run as a terminal snapshot");
  const dir = resolve(root, "exports", id, String(run.attempt_no));
  await mkdir(dir, { recursive: true });
  const records = journal
    .records(id)
    .filter((r) => (r.endDate ?? r.startDate) >= run.options.asOf);
  const atomic = async (name, data) => {
    const tmp = join(dir, `${name}.${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, join(dir, name));
  };
  await atomic(
    "events.jsonl",
    records.map((r) => JSON.stringify(r)).join("\n") +
      (records.length ? "\n" : ""),
  );
  await atomic(
    "result.json",
    JSON.stringify(
      {
        runId: id,
        collectionId: run.collection_id,
        status: run.status,
        config: run.config,
        options: run.options,
        result: run.result,
        error: run.error,
        records: records.length,
      },
      null,
      2,
    ) + "\n",
  );
  return { directory: dir, records: records.length };
}
export async function work(
  journal,
  {
    root = ".artifacts/framework",
    maxJobs = 1,
    runId = null,
    transportFactory = null,
    build = null,
    onProgress = () => {},
    signal = null,
  } = {},
) {
  const loadedBuild = build ?? (await buildId()),
    owner = `${process.pid}-${randomUUID().slice(0, 8)}`,
    completed = [];
  journal.recover();
  for (let i = 0; i < maxJobs && !signal?.aborted; i++) {
    const run = journal.claim(owner, 60000, runId);
    if (!run) break;
    const start = Date.now();
    let leaseError = null,
      input = null,
      task = null,
      stopReason = null;
    const leaseCheck = () => {
      if (leaseError) throw leaseError;
      journal.assertLease(run.id, run.token);
      if (signal?.aborted)
        throw Object.assign(new Error("Worker stopping"), {
          code: "worker_stopping",
        });
    };
    const runtimeCheck = (waitMs = 0) => {
      if (
        run.active_ms + Date.now() - start + waitMs >=
        run.options.maxRuntimeMs
      )
        throw Object.assign(new Error("Active runtime budget exhausted"), {
          code: "runtime_budget",
        });
    };
    const transport = transportFactory
      ? transportFactory(run)
      : new Transport({ root, run, journal, leaseCheck, runtimeCheck });
    const heartbeat = setInterval(() => {
      try {
        journal.heartbeat(run.id, run.token);
      } catch (error) {
        leaseError = error;
        void transport.close().catch(() => {});
      }
    }, 10000);
    try {
      if (run.options.buildId !== loadedBuild)
        throw Object.assign(
          new Error(
            "Adapter build differs from this frozen run; start a new run after reviewing the new code",
          ),
          { code: "adapter_build_changed" },
        );
      for (;;) {
        leaseCheck();
        const state = journal.run(run.id),
          count = journal.records(run.id).length;
        if (!journal.pages(run.id).some((p) => p.state === "pending")) break;
        if (state.requests >= state.options.maxPages) {
          stopReason = "request_budget";
          break;
        }
        if (count >= state.options.maxRecords) {
          stopReason = "record_budget";
          break;
        }
        if (
          state.active_ms + Date.now() - start >=
          state.options.maxRuntimeMs
        ) {
          stopReason = "runtime_budget";
          break;
        }
        task = journal.nextPage(run.id, run.token);
        if (!task) break;
        input = await transport.fetch(task);
        leaseCheck();
        const config = {
          ...run.config,
          maxDepth: run.options.probe ? 0 : run.config.maxDepth,
        };
        const parsed =
          task.kind === "api"
            ? parseApi(input.body, input.url, config, task)
            : parseDocument({
                html: input.body,
                url: input.url,
                config,
                task,
                interaction: input.interaction,
              });
        parsed.acquisition = {
          url: input.url,
          status: input.status,
          kind: task.kind,
          contentHash: input.capture.hash,
          ...(input.interaction ? { interaction: input.interaction } : {}),
        };
        for (const r of parsed.records) {
          if (
            !validDate(r.startDate) ||
            !validDate(r.endDate ?? r.startDate) ||
            (r.endDate && r.endDate < r.startDate)
          )
            throw Object.assign(new Error("Invalid extracted calendar date"), {
              code: "data_quality_error",
            });
          const stamp = (evidence) => ({
            ...evidence,
            capture: input.capture.path,
            contentHash: input.capture.hash,
            ...(evidence.details
              ? { details: evidence.details.map(stamp) }
              : {}),
          });
          r.evidence = stamp(r.evidence);
          if (r.fieldEvidence)
            r.fieldEvidence = Object.fromEntries(
              Object.entries(r.fieldEvidence).map(([key, e]) => [
                key,
                stamp(e),
              ]),
            );
        }
        if (task.meta.enrichRecordIds) {
          const targets = journal
            .records(run.id)
            .filter((r) =>
              task.meta.enrichRecordIds.includes(r.sourceRecordId),
            );
          const bindings = matchDetailBindings(
            targets,
            parsed.records,
            run.config,
          );
          parsed.enrichments = bindings.enrichments;
          parsed.expansions = bindings.expansions;
          if (bindings.matched !== targets.length)
            parsed.issues.push({
              code: "detail_occurrence_not_matched",
              expected: targets.length,
              matched: bindings.matched,
            });
          parsed.records = [];
        }
        journal.commitPage(run.id, run.token, task, parsed, input.capture);
        onProgress({
          runId: run.id,
          collectionId: run.collection_id,
          pageId: task.id,
          records: parsed.records.length,
          method: parsed.method,
        });
        input = null;
        task = null;
      }
      const state = journal.run(run.id),
        result = evaluate(journal, state, stopReason);
      const status =
        result.quality.status === "failed" && !stopReason
          ? "repair_needed"
          : result.complete
            ? "complete"
            : !result.observedRecords && !result.pendingPages
              ? "repair_needed"
              : "partial";
      const error =
        status === "repair_needed"
          ? {
              code:
                result.quality.status === "failed"
                  ? "source_quality_failed"
                  : "no_event_contract_found",
              message:
                result.quality.status === "failed"
                  ? "Source field quality policy failed; inspect quality.failures and captured evidence"
                  : "No dated event records or unresolved enumeration tasks; inspect source adapter",
            }
          : null;
      journal.finish(
        run.id,
        run.token,
        status,
        result,
        error,
        Date.now() - start,
      );
      const exported = await exportRun(journal, run.id, root).catch((e) => ({
        exportError: e.message,
      }));
      completed.push({
        runId: run.id,
        collectionId: run.collection_id,
        status,
        ...result,
        ...exported,
      });
    } catch (error) {
      if (error instanceof LeaseLost || error.code === "lease_lost") {
        completed.push({ runId: run.id, status: "ownership_lost" });
      } else {
        const code =
          error.code ??
          (/Timeout|net::|fetch failed|ECONN/.test(error.message)
            ? "transport_error"
            : "unexpected_error");
        const detail = {
          code,
          message: error.message.slice(0, 1800),
          capture: error.capture ?? input?.capture,
          retryAfterMs: error.retryAfterMs,
        };
        const retry =
          ["rate_limited", "transport_error"].includes(code) &&
          run.attempt_no < run.options.maxRetries;
        const status = [
          "worker_stopping",
          "request_budget",
          "runtime_budget",
        ].includes(code)
          ? "partial"
          : [
                "access_blocked",
                "credentials_required",
                "robots_disallowed",
              ].includes(code)
            ? "blocked_access"
            : retry
              ? "retry_wait"
              : "repair_needed";
        try {
          if (task)
            journal.pageError(
              run.id,
              run.token,
              task.id,
              detail,
              retry ||
                [
                  "worker_stopping",
                  "request_budget",
                  "runtime_budget",
                ].includes(code),
              detail.capture,
            );
          const result = evaluate(journal, journal.run(run.id), code);
          journal.finish(
            run.id,
            run.token,
            status,
            result,
            detail,
            Date.now() - start,
          );
          const exported = await exportRun(journal, run.id, root).catch(
            (e) => ({ exportError: e.message }),
          );
          completed.push({
            runId: run.id,
            collectionId: run.collection_id,
            status,
            error: detail,
            ...result,
            ...exported,
          });
        } catch (fence) {
          if (fence.code === "lease_lost")
            completed.push({ runId: run.id, status: "ownership_lost" });
          else throw fence;
        }
      }
    } finally {
      clearInterval(heartbeat);
      await transport.close().catch(() => {});
    }
    if (runId) break;
  }
  return completed;
}
