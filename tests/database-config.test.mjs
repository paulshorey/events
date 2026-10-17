import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  chmod,
  mkdir,
  copyFile,
  readFile,
} from "node:fs/promises";
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

test("npm db:check selects the local file over an inherited Events URL and requires that file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "events-db-local-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  );
  await mkdir(join(directory, "scripts"));
  await copyFile(
    new URL("../scripts/check-database.mjs", import.meta.url),
    join(directory, "scripts/check-database.mjs"),
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { "db:check": project.scripts["db:check"] },
    }),
  );
  const dev =
    "postgresql://events:dev-test-password@dev.example.test/events?sslmode=require";
  await writeFile(
    join(directory, ".env.local"),
    `DB_EVENTS_URL=${dev}\n# DB_EVENTS_URL=postgresql://production:prod-test-password@prod.example.test/events\n`,
  );
  const client = join(directory, "psql");
  await writeFile(
    client,
    `#!${process.execPath}\nif(process.env.PGHOST !== 'dev.example.test' || process.env.PGPASSWORD !== 'dev-test-password') process.exit(1);\nconsole.log(JSON.stringify({postgresMajor:18,tls:true,readOnly:'on',applicationTables:0}));\n`,
  );
  await chmod(client, 0o700);
  const env = {
    ...process.env,
    DB_EVENTS_URL:
      "postgresql://production:prod-test-password@prod.example.test/events",
    PSQL_PATH: client,
  };
  const check = (environment) =>
    spawnSync("npm", ["run", "db:check", "--silent"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
      env: environment,
    });
  let result = check(env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).connected, true);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /dev-test-password|prod-test-password/,
  );
  await rm(join(directory, ".env.local"));
  // Even a usable inherited URL cannot substitute for the required local file.
  result = check({ ...env, DB_EVENTS_URL: dev });
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /dev-test-password|prod-test-password/,
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
