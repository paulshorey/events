import { spawnSync } from "node:child_process";

// Read-only local smoke check. Keep the URL/password out of argv, diagnostics,
// and output. Loading .env.local is explicit in the npm command.
try {
  const url = new URL(process.env.DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password
  )
    throw new Error("configuration");
  const result = spawnSync(
    process.env.PSQL_PATH || "psql",
    [
      "-X",
      "--no-password",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SELECT json_build_object(
      'postgresMajor', current_setting('server_version_num')::int / 10000,
      'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
      'readOnly', current_setting('transaction_read_only'),
      'applicationTables', (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'));`,
    ],
    {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGSSLMODE: "require",
        PGCONNECT_TIMEOUT: "10",
        PGOPTIONS:
          "-c default_transaction_read_only=on -c statement_timeout=10000",
      },
    },
  );
  if (result.error || result.status !== 0) throw new Error("connection");
  const check = JSON.parse(result.stdout);
  if (check.tls !== true || check.readOnly !== "on") throw new Error("policy");
  console.log(JSON.stringify({ connected: true, ...check }, null, 2));
} catch {
  console.error(
    "Database check failed. Verify DATABASE_URL, public TCP access, and psql installation (or PSQL_PATH). Connection details are suppressed.",
  );
  process.exitCode = 1;
}
