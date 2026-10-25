// Explicit, bounded foreground validation. Never enables schedules or uses the operational journal.
import { cp, mkdir, writeFile, rename } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    ids: { type: "string", default: "url-054,url-039,url-035,url-024,url-080" },
    "max-pages": { type: "string", default: "300" },
    "max-runtime-ms": { type: "string", default: "600000" },
    concurrency: { type: "string", default: "3" },
  },
});
const root = resolve(
  values.root ??
    `.artifacts/source-validation/${new Date().toISOString().replaceAll(":", "-")}`,
);
if (root === resolve(".artifacts/framework"))
  throw new Error(
    "Use separate validation storage, not the operational journal",
  );
const concurrency = Number(values.concurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3)
  throw new Error("Use --concurrency 1..3");
const snapshot = join(root, "candidates", randomUUID());
await mkdir(snapshot, { recursive: true });
for (const path of [
  "src",
  "examples",
  "sources/registry.json",
  "package.json",
]) {
  await mkdir(join(snapshot, path, ".."), { recursive: true });
  await cp(new URL(`../${path}`, import.meta.url), join(snapshot, path), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
const { Journal, hash } = await import(
  pathToFileURL(join(snapshot, "src/storage/journal.mjs"))
);
const { registry } = await import(
  pathToFileURL(join(snapshot, "src/registry.mjs"))
);
const { buildId, optionsFor, work } = await import(
  pathToFileURL(join(snapshot, "src/worker.mjs"))
);
const build = await buildId(),
  configs = await registry(),
  ids = [...new Set(values.ids.split(","))];
if (ids.some((id) => !configs.some((c) => c.id === id)))
  throw new Error("Unknown source ID");
const selected = configs.filter((c) => ids.includes(c.id));
if (selected.some((c) => !c.quality))
  throw new Error("Acceptance requires a source-specific quality policy");
for (const c of selected)
  optionsFor(
    c,
    {
      maxPages: Number(values["max-pages"]),
      maxRuntimeMs: Number(values["max-runtime-ms"]),
    },
    build,
  );
const j = new Journal(join(root, "journal.sqlite"));
j.register(configs);
const report = {
  startedAt: new Date().toISOString(),
  root,
  snapshot,
  build,
  foregroundOnly: true,
  sources: selected.map((c) => ({
    id: c.id,
    url: c.url,
    configHash: hash(c),
    runs: [],
  })),
};
let persistence = Promise.resolve();
const persist = () =>
  (persistence = persistence.then(async () => {
    const tmp = join(snapshot, "validation.tmp.json");
    await writeFile(tmp, JSON.stringify(report, null, 2) + "\n");
    await rename(tmp, join(snapshot, "validation.json"));
  }));
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const groups = [
  ...Map.groupBy(selected, (c) => c.rateKey ?? c.sourceKey).values(),
];
try {
  await persist();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const group = groups.shift();
        if (!group || controller.signal.aborted) return;
        for (const config of group) {
          const source = report.sources.find((s) => s.id === config.id);
          const repairs = j
            .repairs()
            .filter(
              (r) => r.collection_id === config.id && r.status !== "closed",
            );
          if (
            repairs.some(
              (r) => r.status === "claimed" && r.lease_until > Date.now(),
            )
          ) {
            source.blockedByClaim = true;
            await persist();
            continue;
          }
          for (const repair of repairs) {
            const claim = j.claimRepair(
              repair.id,
              `foreground-validator-${process.pid}`,
            );
            j.probation(repair.id, claim.token, build);
          }
          for (let pass = 1; pass <= 2 && !controller.signal.aborted; pass++) {
            const options = optionsFor(
              config,
              {
                maxPages: Number(values["max-pages"]),
                maxRuntimeMs: Number(values["max-runtime-ms"]),
                diagnostics: true,
              },
              build,
            );
            const job = j.enqueue(config.id, options);
            if (!job.created) {
              source.coalescedWithExistingWork = job.runId;
              break;
            }
            const results = await work(j, {
              root,
              runId: job.runId,
              maxJobs: 1,
              build,
              signal: controller.signal,
              onProgress: (e) =>
                console.error(
                  JSON.stringify({ source: config.id, pass, ...e }),
                ),
            });
            const run = j.run(job.runId);
            source.runs.push({
              pass,
              id: run.id,
              status: run.status,
              revision: run.revision,
              options: run.options,
              result: run.result,
              error: run.error,
              exports: results[0]?.exports,
            });
            await persist();
            // Do not repeat an unchanged failed/partial/blocked candidate just to accumulate attempts.
            if (run.status !== "complete") break;
          }
          source.validated =
            source.runs.length === 2 &&
            source.runs.every(
              (r) =>
                r.status === "complete" &&
                r.options.buildId === build &&
                r.result.quality?.status === "passed",
            );
          await persist();
          if (source.runs.at(-1)?.status === "retry_wait") {
            for (const deferred of group.slice(group.indexOf(config) + 1))
              report.sources.find(
                (s) => s.id === deferred.id,
              ).deferredForPublisher = config.id;
            break;
          }
        }
      }
    }),
  );
  report.closedRepairs = j.resolveRepairs(build);
  report.finishedAt = new Date().toISOString();
  report.validated = report.sources.filter((s) => s.validated).map((s) => s.id);
  await persist();
  console.log(
    JSON.stringify(
      {
        report: join(snapshot, "validation.json"),
        build,
        validated: report.validated,
        sources: report.sources.map((s) => ({
          id: s.id,
          validated: !!s.validated,
          runs: s.runs.map((r) => ({
            id: r.id,
            status: r.status,
            records: r.result?.recordCount,
            error: r.error,
          })),
        })),
      },
      null,
      2,
    ),
  );
  if (report.validated.length !== selected.length) process.exitCode = 2;
} finally {
  j.close();
}
