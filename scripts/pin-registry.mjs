// Pin every sources/registry.json entry that the builder would not reproduce,
// then verify that `npm run registry:build` regenerates the registry exactly.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const REGISTRY = "sources/registry.json",
  PINS = "sources/registry-pins.json";
const build = () =>
  execFileSync(process.execPath, ["scripts/build-registry.mjs"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
const committed = JSON.parse(await readFile(REGISTRY, "utf8"));
const normalized = JSON.stringify(committed, null, 2) + "\n";
const previousPins = await readFile(PINS, "utf8").catch(() => null);
try {
  await writeFile(PINS, "[]\n");
  build();
  const generated = JSON.parse(await readFile(REGISTRY, "utf8"));
  const pins = committed.filter((entry) => {
    const g = generated.find((c) => c.id === entry.id);
    return JSON.stringify(g) !== JSON.stringify(entry);
  });
  await writeFile(PINS, JSON.stringify(pins, null, 2) + "\n");
  build();
  const rebuilt = await readFile(REGISTRY, "utf8");
  if (rebuilt !== normalized)
    throw new Error(
      "Registry rebuild with pins does not reproduce the registry",
    );
  console.log(
    JSON.stringify({ entries: committed.length, pinned: pins.length }),
  );
} catch (error) {
  if (previousPins != null) await writeFile(PINS, previousPins);
  throw error;
} finally {
  await writeFile(REGISTRY, normalized);
}
