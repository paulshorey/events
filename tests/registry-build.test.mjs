import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Regeneration must never revert collectors maintained in sources/registry.json.
test("the registry builder reproduces the committed registry exactly", async (t) => {
  const root = new URL("..", import.meta.url).pathname;
  const dir = await mkdtemp(join(tmpdir(), "events-registry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "_working"));
  await cp(
    join(root, "_working/source_assessment.json"),
    join(dir, "_working/source_assessment.json"),
  );
  await cp(join(root, "sources"), join(dir, "sources"), { recursive: true });
  await cp(
    join(root, "scripts/build-registry.mjs"),
    join(dir, "build-registry.mjs"),
  );
  execFileSync(process.execPath, [join(dir, "build-registry.mjs")], {
    cwd: dir,
    stdio: "ignore",
  });
  assert.equal(
    await readFile(join(dir, "sources/registry.json"), "utf8"),
    await readFile(join(root, "sources/registry.json"), "utf8"),
  );
  await writeFile(join(dir, "sources/registry-pins.json"), "[]\n");
  execFileSync(process.execPath, [join(dir, "build-registry.mjs")], {
    cwd: dir,
    stdio: "ignore",
  });
  const unpinned = JSON.parse(
    await readFile(join(dir, "sources/registry.json"), "utf8"),
  );
  for (const id of ["url-012", "url-015", "url-028", "url-083", "url-090"]) {
    assert.equal(unpinned.find((entry) => entry.id === id)?.maxDepth, 0, id);
  }
});
