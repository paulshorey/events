import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Journal } from "./storage/journal.mjs";
import { registry } from "./registry.mjs";
import { optionsFor, buildId, work, exportRun } from "./worker.mjs";
import { parseDocument } from "./adapters/document.mjs";

const projectRoot = resolve(new URL("../", import.meta.url).pathname);
const flags = {
  "--max-pages": "maxPages",
  "--max-records": "maxRecords",
  "--max-runtime-ms": "maxRuntimeMs",
  "--max-retries": "maxRetries",
  "--per-page": "perPage",
  "--as-of": "asOf",
  "--transport": "transport",
  "--max-jobs": "maxJobs",
  "--concurrency": "concurrency",
  "--group": "group",
  "--root": "root",
  "--owner": "owner",
  "--token": "token",
  "--accept-count-change": "acceptCountChange",
  "--probe": "probe",
  "--all": "all",
  "--primary": "primary",
  "--json": "json",
};
const booleans = new Set(["probe", "all", "primary", "json"]);
const numbers = new Set([
  "maxPages",
  "maxRecords",
  "maxRuntimeMs",
  "maxRetries",
  "perPage",
  "maxJobs",
  "concurrency",
]);
function args(argv) {
  const opts = {},
    positionals = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      positionals.push(argv[i]);
      continue;
    }
    const key = flags[argv[i]];
    if (!key) throw new Error(`Unknown flag ${argv[i]}`);
    if (booleans.has(key)) opts[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${argv[i]}`);
      opts[key] = numbers.has(key) ? Number(argv[++i]) : argv[++i];
    }
  }
  for (const key of numbers)
    if (
      opts[key] != null &&
      (!Number.isSafeInteger(opts[key]) || opts[key] < 1)
    )
      throw new Error(`Invalid ${key}`);
  if ((opts.concurrency ?? 1) > 4)
    throw new Error("Use at most four local workers");
  return { opts, positionals };
}
const print = (value) => console.log(JSON.stringify(value, null, 2));
function outcomeExit(results, probe = false) {
  if (
    results.some((r) =>
      ["repair_needed", "blocked_access", "ownership_lost"].includes(r.status),
    )
  )
    process.exitCode = 1;
  else if (results.some((r) => r.status === "retry_wait"))
    process.exitCode = 75;
  else if (!probe && results.some((r) => r.status === "partial"))
    process.exitCode = 2;
}
const compactRun = (r) => ({
  runId: r.id,
  collectionId: r.collection_id,
  status: r.status,
  attempts: r.attempt_no,
  requests: r.requests,
  notBefore: r.not_before,
  result: r.result,
  error: r.error,
});
export async function main(argv) {
  const { opts, positionals } = args(argv),
    [command = "help", id, extra] = positionals;
  const root = resolve(
    opts.root ?? resolve(projectRoot, ".artifacts/framework"),
  );
  const journal = new Journal(resolve(root, "journal.sqlite"));
  try {
    const configs = await registry();
    journal.register(configs);
    const build = await buildId();
    const choose = () =>
      configs.filter(
        (c) =>
          (!opts.primary || c.origin === "primary-list") &&
          (!opts.group || c.group === opts.group),
      );
    const enqueue = (c) => journal.enqueue(c.id, optionsFor(c, opts, build));
    const progress = (event) =>
      console.error(JSON.stringify({ progress: event }));
    const workers = async (runId = null) => {
      const controller = new AbortController(),
        stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        return (
          await Promise.all(
            Array.from({ length: runId ? 1 : (opts.concurrency ?? 1) }, () =>
              work(journal, {
                root,
                runId,
                maxJobs: opts.maxJobs ?? 1,
                build,
                onProgress: progress,
                signal: controller.signal,
              }),
            ),
          )
        ).flat();
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    };
    switch (command) {
      case "init":
        print({
          collections: configs.length,
          journal: resolve(root, "journal.sqlite"),
          enabled: journal.list().filter((c) => c.enabled).length,
        });
        break;
      case "list":
        print(
          journal
            .list()
            .filter((c) => choose().some((s) => s.id === c.id))
            .map((c) => ({
              id: c.id,
              group: c.config.group,
              url: c.config.url,
              adapter: c.config.adapter,
              enabled: !!c.enabled,
              health: c.health,
              lastAttempt: c.last_attempt,
              lastComplete: c.last_complete,
            })),
        );
        break;
      case "run": {
        const c = configs.find((c) => c.id === id);
        if (!c) throw new Error("Use run url-NNN");
        const job = enqueue(c);
        const results = await workers(job.runId);
        print({
          job,
          results,
          run: compactRun(journal.run(job.runId)),
        });
        outcomeExit(results, opts.probe);
        break;
      }
      case "queue": {
        if (!id && !opts.all && !opts.primary && !opts.group)
          throw new Error("Specify a collection, --all, --primary, or --group");
        const selected = id ? configs.filter((c) => c.id === id) : choose();
        if (!selected.length) throw new Error("No matching collections");
        print(selected.map((c) => ({ collectionId: c.id, ...enqueue(c) })));
        break;
      }
      case "work": {
        if (id && !journal.run(id)) throw new Error("Unknown run");
        const results = await workers(id ?? null);
        print(results);
        outcomeExit(results, opts.probe);
        break;
      }
      case "schedule":
      case "tick": {
        journal.recover();
        const jobs = journal.schedule((c) => optionsFor(c, opts, build));
        print({
          enqueued: jobs,
          ...(command === "tick" ? { results: await workers() } : {}),
        });
        break;
      }
      case "enable":
      case "disable": {
        if (!id) throw new Error("Specify one collection");
        journal.configure(id, command === "enable");
        print({ id, enabled: command === "enable" });
        break;
      }
      case "recover":
        print({ recovered: journal.recover() });
        break;
      case "resume": {
        const r = journal.run(id);
        if (!r) throw new Error("Unknown run");
        if (r.options.buildId !== build)
          throw new Error(
            "Code changed: use a fresh run, preserving the old checkpoints as evidence",
          );
        const allowed = {};
        for (const k of [
          "maxPages",
          "maxRecords",
          "maxRuntimeMs",
          "maxRetries",
          "acceptCountChange",
        ])
          if (opts[k] != null) allowed[k] = opts[k];
        print({ resumed: journal.resume(id, allowed) });
        break;
      }
      case "cancel":
        journal.cancel(id);
        print({ cancelled: id });
        break;
      case "show": {
        const r = journal.run(id);
        if (!r) throw new Error("Unknown run");
        print({
          ...r,
          pages: journal.pages(id),
          attempts: journal.db
            .prepare("SELECT * FROM attempts WHERE run_id=? ORDER BY number")
            .all(id),
        });
        break;
      }
      case "export":
        print(await exportRun(journal, id, root));
        break;
      case "status": {
        const runs = journal.db
          .prepare("SELECT id FROM runs ORDER BY created DESC")
          .all()
          .map((r) => journal.run(r.id));
        print({
          collections: configs.length,
          enabled: journal.list().filter((c) => c.enabled).length,
          states: runs.reduce(
            (a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a),
            {},
          ),
          repairs: journal
            .repairs()
            .reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}),
          recent: runs.slice(0, 12).map(compactRun),
        });
        break;
      }
      case "repairs": {
        if (!id || id === "list") print(journal.repairs());
        else if (id === "claim")
          print(
            journal.claimRepair(extra, opts.owner ?? `engineer-${process.pid}`),
          );
        else if (id === "probation") {
          if (!opts.token) throw new Error("Use --token from the repair claim");
          print(journal.probation(extra, opts.token, build));
        } else if (id === "resolve")
          print({ closed: journal.resolveRepairs(build) });
        else
          throw new Error(
            "Use repairs list|claim ID|probation ID --token TOKEN|resolve",
          );
        break;
      }
      case "replay": {
        // Reparse captured evidence without visiting the website or changing stored observations.
        const r = journal.run(id),
          page = journal.pages(id).find((p) => p.id === Number(extra));
        if (!r || !page?.capture)
          throw new Error(
            "Use replay RUN_ID PAGE_ID with a saved HTML capture",
          );
        if (page.kind === "api")
          throw new Error("Use the API fixture tests for API captures");
        print(
          parseDocument({
            html: await readFile(page.capture, "utf8"),
            url: page.url,
            config: journal.collection(r.collection_id).config,
            task: page,
          }),
        );
        break;
      }
      case "report": {
        const rows = journal.list().map((c) => {
          const r = c.last_attempt ? journal.run(c.last_attempt) : null;
          return {
            id: c.id,
            group: c.config.group,
            url: c.config.url,
            script: c.config.script,
            adapter: c.config.adapter,
            coverage: c.config.coverage,
            enabled: !!c.enabled,
            latest: r
              ? {
                  runId: r.id,
                  status: r.status,
                  records: r.result?.recordCount ?? 0,
                  pages: r.result?.pagesDone ?? 0,
                  requests: r.requests,
                  stopReason: r.result?.stopReason,
                  error: r.error?.code,
                  build: r.options.buildId,
                }
              : null,
            lastComplete: c.last_complete,
            repairs: journal
              .repairs()
              .filter((r) => r.collection_id === c.id && r.status !== "closed")
              .map((r) => ({ id: r.id, code: r.code, status: r.status })),
          };
        });
        const output = resolve(
          projectRoot,
          "_working/framework_source_results.json",
        );
        await mkdir(resolve(projectRoot, "_working"), { recursive: true });
        await writeFile(
          output,
          JSON.stringify(
            { generatedAt: new Date().toISOString(), build, rows },
            null,
            2,
          ) + "\n",
        );
        await writeFile(
          resolve(projectRoot, "_working/framework_source_results.md"),
          `# Per-URL scraper results\n\nGenerated ${new Date().toISOString()}. A partial result is not complete enumeration. Blank entries have not been run in this journal. All schedules are opt-in.\n\n| ID | Group | Source | Adapter | Latest state | Events | Reason |\n| --- | --- | --- | --- | --- | ---: | --- |\n` +
            rows
              .map(
                (r) =>
                  `| ${r.id} | ${r.group} | [URL](${r.url}) | ${r.adapter} | ${r.latest?.status ?? "not run"} | ${r.latest?.records ?? 0} | ${r.latest?.error ?? r.latest?.stopReason ?? ""} |`,
              )
              .join("\n") +
            "\n",
        );
        print({
          output,
          collections: rows.length,
          counts: rows.reduce(
            (a, r) => (
              (a[r.latest?.status ?? "not_run"] =
                (a[r.latest?.status ?? "not_run"] ?? 0) + 1),
              a
            ),
            {},
          ),
        });
        break;
      }
      case "help":
        print({
          commands: [
            "init",
            "list [--group NAME]",
            "run url-NNN [--probe] [--max-pages N] [--transport browser|api]",
            "queue url-NNN|--all|--primary|--group NAME",
            "work [RUN_ID] --max-jobs N --concurrency 1..4",
            "schedule",
            "tick --max-jobs N",
            "enable|disable url-NNN",
            "recover",
            "resume RUN_ID --max-pages N",
            "cancel RUN_ID",
            "show RUN_ID",
            "export RUN_ID",
            "repairs list|claim ID|probation ID --token TOKEN|resolve",
            "replay RUN_ID PAGE_ID",
            "report",
          ],
          notes: [
            "No model calls, external database, background service, or Codex task is started by init.",
            "Global options: --root PATH, --as-of YYYY-MM-DD, --max-runtime-ms N, --max-records N.",
            "max-jobs is per worker. Full enumeration uses pagination contracts; probes always remain partial.",
          ],
        });
        break;
      default:
        throw new Error(`Unknown command ${command}`);
    }
  } finally {
    journal.close();
  }
}
export async function scraperMain(id, argv) {
  try {
    await main(["run", id, ...argv]);
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  }
}
