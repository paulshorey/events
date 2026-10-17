import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("database check selects Events when a different global DATABASE_URL exists", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "events-db-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = join(directory, "psql");
  await writeFile(
    client,
    `#!${process.execPath}
if (process.env.PGHOST !== 'events.example.test' || process.env.PGUSER !== 'events' || process.env.PGPASSWORD !== 'events-test-password' || process.env.PGDATABASE !== 'events' || process.env.PGSSLMODE !== 'require' || process.argv.some(arg => arg.includes('events-test-password'))) process.exit(1);
console.log(JSON.stringify({postgresMajor:18,tls:true,readOnly:'on',applicationTables:0}));
`,
  );
  await chmod(client, 0o700);
  const result = spawnSync(process.execPath, ["scripts/check-database.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DB_EVENTS_URL:
        "postgresql://events:events-test-password@events.example.test/events?sslmode=require",
      DATABASE_URL:
        "postgresql://other:other-test-password@other.example.test/other",
      PSQL_PATH: client,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).connected, true);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /events-test-password|other-test-password/,
  );
});

test("database check refuses to fall back to global DATABASE_URL", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "events-db-fallback-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = join(directory, "psql");
  // A fallback would succeed with this client and make the test fail.
  await writeFile(
    client,
    `#!${process.execPath}\nconsole.log(JSON.stringify({postgresMajor:18,tls:true,readOnly:'on',applicationTables:0}));\n`,
  );
  await chmod(client, 0o700);
  const env = {
    ...process.env,
    DATABASE_URL:
      "postgresql://other:other-test-password@other.example.test/other",
    PSQL_PATH: client,
  };
  delete env.DB_EVENTS_URL;
  const result = spawnSync(process.execPath, ["scripts/check-database.mjs"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DB_EVENTS_URL/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /other-test-password|other\.example/,
  );
});
