import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import pg from "pg";

// Disposable PostgreSQL for destructive delivery tests. Never uses
// DB_EVENTS_URL. EVENTS_TEST_PG_URL may name a throwaway server (CI service
// container); otherwise a private cluster is created with initdb on loopback.
function findBin() {
  const candidates = [
    process.env.PG_BIN,
    ...["/opt/homebrew/opt", "/usr/local/opt"].flatMap((d) =>
      existsSync(d)
        ? readdirSync(d)
            .filter((n) => /^postgresql(@\d+)?$/.test(n))
            .sort()
            .reverse()
            .map((n) => join(d, n, "bin"))
        : [],
    ),
    ...(existsSync("/usr/lib/postgresql")
      ? readdirSync("/usr/lib/postgresql")
          .sort((a, b) => b - a)
          .map((v) => `/usr/lib/postgresql/${v}/bin`)
      : []),
  ].filter(Boolean);
  return candidates.find((d) => existsSync(join(d, "initdb")));
}
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });

let server = null;
async function startServer() {
  if (process.env.EVENTS_TEST_PG_URL)
    return { admin: process.env.EVENTS_TEST_PG_URL };
  const bin = findBin();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), "events-pg-")),
    data = join(dir, "data"),
    port = await freePort();
  const init = spawnSync(
    join(bin, "initdb"),
    ["-D", data, "-U", "events_test", "-A", "trust", "--no-sync"],
    {
      encoding: "utf8",
    },
  );
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const start = spawnSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      data,
      "-w",
      "-l",
      join(dir, "log"),
      "-o",
      `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
      "start",
    ],
    { encoding: "utf8" },
  );
  if (start.status !== 0)
    throw new Error(`pg_ctl start failed: ${start.stderr}`);
  const stop = () => {
    spawnSync(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  };
  process.on("exit", stop);
  return {
    admin: `postgres://events_test@127.0.0.1:${port}/postgres?sslmode=disable`,
    stop,
  };
}

// Returns a URL for a fresh empty database, or null when PostgreSQL is absent.
export async function disposableDatabase(t) {
  server ??= startServer();
  const s = await server;
  if (!s) return null;
  const name = `events_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({
    connectionString: s.admin.replace(/[?&]sslmode=disable/, ""),
    ssl: false,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  // Databases are not dropped per test: the private cluster is deleted at exit
  // and an EVENTS_TEST_PG_URL server must itself be disposable.
  const u = new URL(s.admin);
  u.pathname = `/${name}`;
  u.searchParams.set("sslmode", "disable");
  return u.href;
}
