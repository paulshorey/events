import { readFile, mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { hash } from "./storage/journal.mjs";
import { parseDocument } from "./adapters/document.mjs";
import { parseApi, buildId } from "./worker.mjs";
import { fieldSummary, matchDetailBindings } from "./event-fields.mjs";
import { assessQuality } from "./quality.mjs";

export function inspectSource(journal, id, currentConfig) {
  const c = journal.collection(id);
  if (!c) throw new Error("Unknown collection");
  const run = c.last_attempt ? journal.run(c.last_attempt) : null;
  const pages = run ? journal.pages(run.id) : [],
    records = run ? journal.records(run.id) : [];
  return {
    collectionId: id,
    url: c.config.url,
    enabled: !!c.enabled,
    health: c.health,
    currentConfig,
    storedConfig: c.config,
    lastComplete: c.last_complete,
    lastGood: c.last_good,
    run,
    fields: fieldSummary(records),
    repairs: journal
      .repairs()
      .filter((r) => r.collection_id === id)
      .map((r) => ({ ...r, token: r.token ? "REDACTED" : null })),
    pages,
    samples: records.slice(0, 3),
    commands: run
      ? {
          replay: `replay ${run.id} PAGE_ID`,
          compare: `compare ${run.id}`,
          bundle: `bundle ${run.id}`,
          show: `show ${run.id}`,
        }
      : {},
  };
}

export async function replayPage(journal, runId, pageId, config) {
  const run = journal.run(runId),
    page = journal.pages(runId).find((p) => p.id === Number(pageId));
  if (!run || !page?.capture)
    throw new Error("Replay requires a run/page with saved evidence");
  const body = await readFile(page.capture, "utf8"),
    contentHash = hash(body);
  const expected = page.content_hash ?? page.error?.capture?.hash;
  if (expected && contentHash !== expected)
    throw new Error(`Capture integrity failed for page ${page.id}`);
  const url =
    page.result?.acquisition?.url ?? page.error?.capture?.url ?? page.url;
  const replayConfig = { ...config, asOf: config.asOf ?? run.options?.asOf };
  const result =
    page.kind === "api"
      ? parseApi(body, url, replayConfig, page)
      : parseDocument({
          html: body,
          url,
          config: replayConfig,
          task: page,
          interaction: page.result?.acquisition?.interaction,
        });
  const $ = page.kind === "api" ? null : load(body);
  const selectors = [
    ...new Set(
      [config.readySelector, ...(config.cardSelectors ?? [])].filter(Boolean),
    ),
  ].map((selector) => {
    try {
      return { selector, count: $ ? $(selector).length : null };
    } catch (e) {
      return { selector, error: e.message };
    }
  });
  return {
    pageId: page.id,
    url,
    contentHash,
    kind: page.kind,
    selectors,
    result,
  };
}

export async function replayRun(journal, runId, config) {
  const run = journal.run(runId);
  if (!run) throw new Error("Unknown run");
  const output = new Map(),
    pages = [],
    errors = [];
  const tasks = journal
    .pages(runId)
    .sort(
      (a, b) =>
        Number(a.kind === "detail") - Number(b.kind === "detail") ||
        a.id - b.id,
    );
  for (const page of tasks) {
    if (page.state !== "done")
      errors.push({
        pageId: page.id,
        code: "page_not_committed",
        state: page.state,
        captured: !!page.capture,
      });
    if (!page.capture) {
      errors.push({
        pageId: page.id,
        code: "capture_missing",
        state: page.state,
      });
      continue;
    }
    try {
      const replay = await replayPage(journal, runId, page.id, config),
        parsed = replay.result;
      if (page.meta.enrichRecordIds) {
        const bindings = matchDetailBindings(
          page.meta.enrichRecordIds.map((id) => output.get(id)).filter(Boolean),
          parsed.records,
          config,
        );
        for (const record of bindings.enrichments)
          output.set(record.sourceRecordId, record);
        for (const expansion of bindings.expansions) {
          output.delete(expansion.parentRecordId);
          for (const record of expansion.records)
            output.set(record.sourceRecordId, record);
        }
        if (bindings.matched !== page.meta.enrichRecordIds.length)
          parsed.issues.push({
            code: "detail_occurrence_not_matched",
            expected: page.meta.enrichRecordIds.length,
            matched: bindings.matched,
          });
      } else
        for (const record of parsed.records)
          if (!output.has(record.sourceRecordId))
            output.set(record.sourceRecordId, record);
      pages.push({
        ...replay,
        result: {
          ...parsed,
          records: undefined,
          fields: fieldSummary(parsed.records),
        },
      });
    } catch (e) {
      errors.push({
        pageId: page.id,
        code: e.code ?? "replay_error",
        message: e.message,
      });
    }
  }
  const records = [...output.values()];
  return {
    runId,
    evidenceOnly: true,
    replayComplete: !errors.length,
    originalRunStatus: run.status,
    configHash: hash(config),
    pages,
    errors,
    fields: fieldSummary(records),
    quality: assessQuality(
      records,
      pages.map((p) => ({
        ...p.result,
        acquisition: { ...p.result.acquisition, kind: p.kind },
      })),
      config.quality,
    ),
    records,
  };
}

const comparedFields = [
  "title",
  "url",
  "startDate",
  "endDate",
  "startLocal",
  "endLocal",
  "timeZone",
  "timeZoneLabel",
  "allDay",
  "location",
  "geoCoordinates",
  "categoryTags",
  "warnings",
  "fieldQuality",
];
const stable = (v) =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(stable(x) ?? "null"))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(stable(v[k]) ?? "null")]),
          )
      : v,
  );
export function compareRecords(before, after) {
  const a = new Map(before.map((r) => [r.sourceRecordId, r])),
    b = new Map(after.map((r) => [r.sourceRecordId, r]));
  const added = [...b.keys()].filter((k) => !a.has(k)),
    removed = [...a.keys()].filter((k) => !b.has(k)),
    changed = [];
  for (const [id, record] of b)
    if (a.has(id)) {
      const fields = comparedFields
        .filter((f) => stable(a.get(id)[f]) !== stable(record[f]))
        .map((f) => ({
          field: f,
          before: a.get(id)[f] ?? null,
          after: record[f] ?? null,
        }));
      if (fields.length) changed.push({ sourceRecordId: id, fields });
    }
  return {
    before: fieldSummary(before),
    after: fieldSummary(after),
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    added,
    removed,
    changed,
  };
}

export async function writeBundle(journal, runId, currentConfig, directory) {
  const run = journal.run(runId);
  if (!run || run.status === "running")
    throw new Error("Bundle requires a terminal run");
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory); // Never overwrite an earlier evidence packet.
  const replay = await replayRun(journal, runId, currentConfig);
  const report = {
    candidateBuild: await buildId(),
    generatedAt: new Date().toISOString(),
    ...inspectSource(journal, run.collection_id, currentConfig),
    run,
    pages: journal.pages(runId),
    fields: fieldSummary(journal.records(runId)),
    observations: journal.records(runId),
    samples: journal.records(runId).slice(0, 3),
    replay,
    comparison: compareRecords(journal.records(runId), replay.records),
    evidence: [],
  };
  for (const page of journal.pages(runId)) {
    for (const file of [
      page.capture,
      ...(page.capture
        ? [
            join(dirname(page.capture), `page-${page.id}-failure.png`),
            join(dirname(page.capture), `page-${page.id}-diagnostics.json`),
            join(dirname(page.capture), `page-${page.id}-sample.png`),
          ]
        : []),
    ].filter(Boolean)) {
      const target = `page-${page.id}-${basename(file)}`;
      try {
        await access(file);
        await copyFile(file, join(directory, target));
        report.evidence.push({
          pageId: page.id,
          file: target,
          original: file,
          hash: createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        });
      } catch (e) {
        if (file === page.capture)
          report.evidence.push({
            pageId: page.id,
            original: file,
            error: e.message,
          });
      }
    }
  }
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    join(directory, "README.txt"),
    `Offline extraction evidence for ${run.collection_id}, run ${runId}.\nreport.json includes frozen and candidate configuration, selector counts, parser replay, record differences, and copied evidence.\nA replay uses only these saved pages; it does not establish live enumeration completeness.\nOriginal captures remain unchanged.\n`,
    { flag: "wx" },
  );
  return {
    directory,
    report: join(directory, "report.json"),
    evidenceFiles: report.evidence.length,
    replayComplete: replay.replayComplete,
  };
}

export async function replayBundle(directory, currentConfig) {
  const report = JSON.parse(
    await readFile(join(directory, "report.json"), "utf8"),
  );
  const pages = report.pages.map((p) => {
    const evidence = report.evidence.find(
      (e) => e.original === p.capture && e.file,
    );
    if (evidence && basename(evidence.file) !== evidence.file)
      throw new Error("Bundle evidence paths must be local filenames");
    return { ...p, capture: evidence ? join(directory, evidence.file) : null };
  });
  const snapshot = { run: () => report.run, pages: () => pages };
  const replay = await replayRun(
    snapshot,
    report.run.id,
    currentConfig ?? report.run.config,
  );
  return {
    ...replay,
    comparison: compareRecords(report.observations, replay.records),
  };
}
