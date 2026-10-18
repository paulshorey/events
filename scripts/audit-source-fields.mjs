// Bounded rendered-DOM inspection. This does not mutate the operational journal,
// enable schedules, or certify complete source enumeration.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { Transport } from "../src/runtime/transport.mjs";
import { Journal } from "../src/storage/journal.mjs";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { buildId } from "../src/worker.mjs";
import { fieldSummary } from "../src/event-fields.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    ids: { type: "string" },
    details: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
    resume: { type: "boolean", default: false },
  },
});
const detailLimit = Number(values.details),
  concurrency = Number(values.concurrency);
if (
  !Number.isInteger(detailLimit) ||
  detailLimit < 0 ||
  detailLimit > 2 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 3
)
  throw new Error("Use --details 0..2 and --concurrency 1..3");
const root = resolve(
  values.root ??
    `.artifacts/field-audits/${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(root, { recursive: true });
const codeBuild = await buildId(),
  journal = new Journal(":memory:");
const all = await registry(),
  ids = values.ids?.split(",");
if (ids?.some((id) => !all.some((c) => c.id === id)))
  throw new Error("Unknown collection ID");
const configs = all.filter((c) => !ids || ids.includes(c.id));
let rows = [];
if (values.resume) {
  const saved = JSON.parse(await readFile(join(root, "audit.json"), "utf8"));
  if (saved.build !== codeBuild)
    throw new Error("Resume requires the same parser build");
  rows = saved.rows;
}
const groups = [
  ...Map.groupBy(
    configs.filter((c) => !rows.some((r) => r.id === c.id)),
    (c) => c.rateKey ?? c.sourceKey,
  ).values(),
];
let persistence = Promise.resolve();
const persist = () => {
  persistence = persistence.then(async () => {
    const tmp = join(root, `audit.${randomUUID()}.tmp`);
    await writeFile(
      tmp,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          build: codeBuild,
          scope: "Bounded listing/detail inspection, not full enumeration",
          rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
        },
        null,
        2,
      ) + "\n",
    );
    await rename(tmp, join(root, "audit.json"));
  });
  return persistence;
};
function elements(html, config) {
  const $ = load(html);
  const selectors = [
    ...new Set(
      [
        config.readySelector,
        ...(config.cardSelectors ?? []),
        "time[datetime]",
        "[itemprop]",
        "address",
        "[class*=venue]",
        "[class*=location]",
        "[class*=address]",
        "[data-lat]",
        "[data-latitude]",
        "iframe[src]",
      ].filter(Boolean),
    ),
  ];
  return selectors
    .map((selector) => {
      try {
        const found = $(selector);
        return {
          selector,
          count: found.length,
          samples: found
            .slice(0, 3)
            .map((_, el) => ({
              text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 650),
              html: $.html(el).slice(0, 1800),
            }))
            .get(),
        };
      } catch (error) {
        return { selector, error: error.message };
      }
    })
    .filter((e) => e.count || e.error);
}
function summary(records) {
  return fieldSummary(records);
}
async function inspect(config) {
  const run = {
    id: config.id,
    attemptId: randomUUID(),
    config,
    source_key: config.rateKey ?? config.sourceKey,
  };
  const transport = new Transport({ root, run, journal, timeoutMs: 20000 });
  const row = {
    id: config.id,
    url: config.url,
    group: config.group,
    origin: config.origin,
    adapter: config.adapter,
    inspectedAt: new Date().toISOString(),
    pages: [],
  };
  let taskId = 0;
  async function visit(url, kind) {
    const task = {
      id: ++taskId,
      url,
      kind,
      depth: kind === "detail" ? 1 : 0,
      meta: {},
    };
    const page = { requestedUrl: url, kind };
    row.pages.push(page);
    try {
      const input = await transport.fetch(task);
      Object.assign(page, {
        url: input.url,
        status: input.status,
        capture: input.capture,
      });
      page.elements = elements(input.body, config);
      const parsed = parseDocument({
        html: input.body,
        url: input.url,
        config: { ...config, maxDepth: 1 },
        task,
      });
      Object.assign(page, {
        method: parsed.method,
        fields: summary(parsed.records),
        issues: parsed.issues,
        records: parsed.records,
        discoveryLinks: parsed.discoveryLinks,
        nextRequests: parsed.nextRequests,
      });
      return parsed;
    } catch (error) {
      page.error = {
        code: error.code ?? "transport_error",
        message: error.message.slice(0, 700),
        capture: error.capture,
      };
      return null;
    }
  }
  try {
    const listing = await visit(
      config.entrypoints?.[0]?.url ?? config.entrypoints?.[0] ?? config.url,
      "listing",
    );
    if (listing) {
      const hosts = [
        new URL(config.url).hostname,
        ...(config.allowedHosts ?? []),
      ].map((h) => h.replace(/^www\./, ""));
      const candidates = [
        ...new Set([
          ...listing.records.map((r) => r.url),
          ...(listing.nextRequests ?? [])
            .filter((r) => r.kind === "detail")
            .map((r) => r.url),
          ...(listing.discoveryLinks ?? []),
        ]),
      ].filter((u) => {
        try {
          const x = new URL(u);
          return (
            hosts.includes(x.hostname.replace(/^www\./, "")) &&
            !x.hash &&
            x.href !== config.url
          );
        } catch {
          return false;
        }
      });
      for (const url of candidates.slice(0, detailLimit))
        await visit(url, "detail");
    }
    row.outcome = row.pages[0].error
      ? row.pages[0].error.code
      : row.pages.some((p) => p.fields?.records)
        ? "sample_extracted"
        : "no_event_sample";
  } finally {
    await transport.close();
  }
  rows.push(row);
  await persist();
  console.log(
    JSON.stringify({
      completed: rows.length,
      total: configs.length,
      id: row.id,
      outcome: row.outcome,
      fields: row.pages.map((p) => p.fields ?? p.error?.code),
    }),
  );
}
try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const group = groups.shift();
        if (!group) break;
        for (const config of group) await inspect(config);
      }
    }),
  );
  await persistence;
  console.log(
    JSON.stringify({
      report: join(root, "audit.json"),
      completed: rows.length,
    }),
  );
} finally {
  journal.close();
}
