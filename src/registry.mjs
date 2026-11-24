import { readFile } from "node:fs/promises";
import { hash } from "./storage/journal.mjs";
import { validateQualityPolicy } from "./quality.mjs";
export async function registry() {
  const configs = JSON.parse(
    await readFile(new URL("../sources/registry.json", import.meta.url)),
  );
  const seen = new Set();
  for (const c of configs) {
    if (seen.has(c.id) || !/^url-\d{3}$/.test(c.id))
      throw new Error(`Invalid/duplicate ID ${c.id}`);
    seen.add(c.id);
    if (!c.adapter || !Number.isFinite(c.intervalHours) || c.intervalHours <= 0)
      throw new Error(`Invalid configuration ${c.id}`);
    for (const url of c.entrypoints ?? [c.url])
      if (
        !["http:", "https:"].includes(
          new URL(typeof url === "string" ? url : url.url).protocol,
        )
      )
        throw new Error(`Invalid URL ${c.id}`);
    new Intl.DateTimeFormat("en", { timeZone: c.timeZone });
    new RegExp(c.detailPattern);
    validateQualityPolicy(c.quality);
    if (
      c.apiQuery != null &&
      (typeof c.apiQuery !== "object" ||
        Array.isArray(c.apiQuery) ||
        !c.apiEndpoint ||
        Object.entries(c.apiQuery).some(
          ([k, v]) =>
            !/^[a-z_]+$/.test(k) ||
            ["per_page", "page", "start_date"].includes(k) ||
            typeof v !== "string" ||
            !v,
        ))
    )
      throw new Error(`Invalid apiQuery ${c.id}`);
    if (
      c.minIntervalMs != null &&
      (!Number.isSafeInteger(c.minIntervalMs) ||
        c.minIntervalMs < 1000 ||
        c.minIntervalMs > 5000)
    )
      throw new Error(`Invalid publisher pacing ${c.id}`);
  }
  return configs;
}
export function parserRevision(config, build) {
  return hash({ config, build });
}
