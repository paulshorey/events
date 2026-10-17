import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { registry } from "./registry.mjs";

export async function probeRuntime() {
  const collections = await registry();
  const db = new DatabaseSync(":memory:");
  try {
    db.prepare("SELECT 1 AS ready").get();
  } finally {
    db.close();
  }
  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  try {
    await browser.newPage();
  } finally {
    await browser.close();
  }
  return {
    chromium: true,
    sqliteEngine: true,
    registeredCollections: collections.length,
  };
}

// A passive deployment host. This module has no dispatch loop or mutation endpoints.
export function createService({
  readiness = probeRuntime,
  environment = process.env,
} = {}) {
  let state = "starting",
    capabilities = null;
  const metadata = {
    service: "events",
    environment: environment.APP_ENVIRONMENT ?? "local",
    commit: environment.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: environment.RAILWAY_GIT_BRANCH ?? null,
    collectionMode: "manual-only",
    schedulerRunning: false,
  };
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    let payload;
    if (!["GET", "HEAD"].includes(request.method)) {
      response.statusCode = 405;
      response.setHeader("Allow", "GET, HEAD");
      payload = { error: "method_not_allowed" };
    } else if (!["/api/health", "/healthz"].includes(pathname)) {
      response.statusCode = 404;
      payload = { error: "not_found" };
    } else {
      response.statusCode = state === "ready" ? 200 : 503;
      payload = {
        status: state === "ready" ? "ok" : state,
        ...metadata,
        capabilities,
      };
    }
    response.end(
      request.method === "HEAD" ? undefined : JSON.stringify(payload),
    );
  });
  const ready = Promise.resolve()
    .then(readiness)
    .then(
      (result) => {
        capabilities = result;
        if (state === "starting") state = "ready";
        return result;
      },
      (error) => {
        state = "unhealthy";
        throw error;
      },
    );
  const close = async () => {
    state = "stopping";
    if (!server.listening) return;
    const force = setTimeout(() => server.closeAllConnections(), 8000);
    force.unref();
    try {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    } finally {
      clearTimeout(force);
    }
  };
  return { server, ready, close };
}

export async function startService() {
  const port = Number(process.env.PORT ?? 4500);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const app = createService();
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, "0.0.0.0", resolve);
  });
  const stop = () => {
    void app.close().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await app.ready;
    console.log(
      JSON.stringify({
        service: "events",
        state: "ready",
        port,
        schedulerRunning: false,
      }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startService().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
