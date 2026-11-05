// Deliver terminal journal runs to the Events PostgreSQL database.
// Uses only DB_EVENTS_URL (--local: the active value in .env.local). Never
// prints the connection URL. Collection does not depend on this command.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { eventsDatabaseUrl } from "../src/storage/postgres.mjs";
import { deliver } from "../src/delivery.mjs";

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    root: { type: "string", multiple: true },
    run: { type: "string", multiple: true },
    migrate: { type: "boolean", default: false },
    "migrate-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "no-evidence": { type: "boolean", default: false },
    "no-verify": { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
  },
});
const roots = (values.root ?? [".artifacts/framework"]).map((r) => resolve(r));
let url;
try {
  url = eventsDatabaseUrl({ local: values.local });
} catch (e) {
  console.error(`${e.message}. Connection details are suppressed.`);
  process.exit(1);
}
if (values["migrate-only"]) {
  const { connect, migrate } = await import("../src/storage/postgres.mjs");
  let client;
  try {
    client = await connect(url);
    console.log(JSON.stringify({ migrations: await migrate(client) }, null, 2));
  } catch (e) {
    console.error(
      JSON.stringify({
        error: e.code ?? "migration_failed",
        message: e.message.replace(/postgres(ql)?:\/\/\S+/g, "[redacted]"),
      }),
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
  process.exit();
}
const log = values.quiet
  ? () => {}
  : (line) => console.error(JSON.stringify(line));
try {
  const report = await deliver({
    url,
    roots,
    runIds: values.run ?? null,
    dryRun: values["dry-run"],
    evidence: !values["no-evidence"],
    verify: !values["no-verify"],
    applyMigrations: values.migrate,
    log,
  });
  const summary = report.journals.map(({ runs, ...j }) => j);
  console.log(
    JSON.stringify(
      {
        target: report.target,
        migrations: report.migrations,
        journals: summary,
        failures: report.journals.flatMap((j) => j.runs.filter((r) => r.error)),
        pending: values["dry-run"]
          ? report.journals.flatMap((j) => j.runs)
          : undefined,
      },
      null,
      2,
    ),
  );
  if (report.journals.some((j) => j.failed || j.error)) process.exitCode = 1;
} catch (e) {
  // Database outage or lost connection: nothing in the journal changed; the
  // outbox records the failed attempt and a later run retries it.
  console.error(
    JSON.stringify(
      {
        error: e.code ?? "delivery_failed",
        message: e.message.replace(/postgres(ql)?:\/\/\S+/g, "[redacted]"),
        journals: e.report?.journals.map(({ runs, ...j }) => j),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
