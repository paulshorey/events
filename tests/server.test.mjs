import test from "node:test";
import assert from "node:assert/strict";
import { createService, probeRuntime } from "../src/server.mjs";

async function listening(app) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}
test("health waits for readiness, publishes only release metadata, and exposes no dispatch routes", async (t) => {
  let resolveReady;
  const app = createService({
    readiness: () =>
      new Promise((resolve) => {
        resolveReady = resolve;
      }),
    environment: {
      APP_ENVIRONMENT: "dev",
      RAILWAY_GIT_COMMIT_SHA: "test-commit",
      RAILWAY_GIT_BRANCH: "main",
      DATABASE_URL: "must-not-appear",
    },
  });
  t.after(() => app.close());
  const base = await listening(app);
  assert.equal((await fetch(base + "/api/health")).status, 503);
  resolveReady({
    chromium: true,
    sqliteEngine: true,
    registeredCollections: 97,
  });
  await app.ready;
  const response = await fetch(base + "/api/health"),
    body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.commit, "test-commit");
  assert.equal(body.schedulerRunning, false);
  assert.equal(body.collectionMode, "manual-only");
  assert.equal(body.capabilities.registeredCollections, 97);
  assert.ok(!JSON.stringify(body).includes("must-not-appear"));
  assert.equal((await fetch(base + "/admin/run")).status, 404);
  assert.equal(
    (await fetch(base + "/api/health", { method: "POST" })).status,
    405,
  );
  const head = await fetch(base + "/healthz", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
test("a failed capability probe stays unhealthy", async (t) => {
  let rejectReady;
  const app = createService({
    readiness: () =>
      new Promise((_, reject) => {
        rejectReady = reject;
      }),
  });
  t.after(() => app.close());
  const base = await listening(app);
  const checked = assert.rejects(app.ready, /browser unavailable/);
  rejectReady(new Error("browser unavailable"));
  await checked;
  const r = await fetch(base + "/healthz");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).status, "unhealthy");
});
test("real readiness launches Chromium, opens SQLite in memory and validates the registry", async () => {
  assert.deepEqual(await probeRuntime(), {
    chromium: true,
    sqliteEngine: true,
    registeredCollections: 97,
  });
});
