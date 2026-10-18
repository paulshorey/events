// Replays immutable rendered captures. No requests, queue mutations, or changes
// to historical observations. Pass audit files from one or more browser passes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { fieldSummary, mergeDetail } from "../src/event-fields.mjs";
import { buildId } from "../src/worker.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string", multiple: true },
    output: { type: "string", default: "_working/source_field_quality" },
  },
});
if (!values.input?.length)
  throw new Error(
    "Pass --input PATH/audit.json (repeat for later inspections)",
  );
const sources = new Map(),
  inputBuilds = [];
for (const path of values.input) {
  const audit = JSON.parse(await readFile(resolve(path), "utf8"));
  inputBuilds.push({
    path: relative(process.cwd(), resolve(path)),
    build: audit.build,
    generatedAt: audit.generatedAt,
  });
  for (const row of audit.rows) sources.set(row.id, row);
}
const rows = [];
for (const config of await registry()) {
  const source = sources.get(config.id);
  if (!source)
    throw new Error(
      `No browser inspection for ${config.id}; report must account for every URL`,
    );
  const pages = [],
    listingRecords = [],
    detailRecords = [];
  for (const page of source.pages) {
    const capture = page.capture ?? page.error?.capture;
    if (!page.capture || page.error) {
      pages.push({
        kind: page.kind,
        url: page.requestedUrl,
        error: page.error,
        capture: capture?.path ? relative(process.cwd(), capture.path) : null,
      });
      continue;
    }
    try {
      const parsed = parseDocument({
        html: await readFile(page.capture.path, "utf8"),
        url: page.url,
        config,
        task: { kind: page.kind, depth: page.kind === "listing" ? 0 : 1 },
      });
      pages.push({
        kind: page.kind,
        url: page.url,
        capture: relative(process.cwd(), page.capture.path),
        contentHash: page.capture.hash,
        method: parsed.method,
        fields: fieldSummary(parsed.records),
        issues: parsed.issues,
        queuedDetails: parsed.nextRequests.filter((r) => r.kind === "detail")
          .length,
        elementSelectors: (page.elements ?? []).map((e) => ({
          selector: e.selector,
          count: e.count,
        })),
      });
      if (page.kind === "listing") listingRecords.push(...parsed.records);
      else
        detailRecords.push({
          requestedUrl: page.requestedUrl,
          records: parsed.records,
        });
    } catch (error) {
      pages.push({
        kind: page.kind,
        url: page.url,
        error: { code: "replay_error", message: error.message },
      });
    }
  }
  const records = [...listingRecords],
    matchedDetails = new Set();
  for (let i = 0; i < records.length; i++)
    for (const detail of detailRecords) {
      if (records[i].url !== detail.requestedUrl) continue;
      const matches = detail.records
        .map((r) =>
          mergeDetail(records[i], r, {
            allowDateRange: config.adapter === "opencities",
            titleAliases: config.detailTitleAliases,
          }),
        )
        .filter(Boolean);
      if (matches.length === 1) {
        records[i] = matches[0];
        matchedDetails.add(detail);
      }
    }
  // Detail-only discovery is reported separately; it is not represented as a
  // validated merge into unrelated listing occurrences.
  const standalone = detailRecords
    .filter((d) => !matchedDetails.has(d))
    .flatMap((d) => d.records);
  const unmatchedDetails = detailRecords
    .filter(
      (d) =>
        !matchedDetails.has(d) &&
        listingRecords.some((r) => r.url === d.requestedUrl),
    )
    .map((d) => ({
      code: "detail_occurrence_not_matched",
      requestedUrl: d.requestedUrl,
      listing: listingRecords
        .filter((r) => r.url === d.requestedUrl)
        .map((r) => ({
          title: r.title,
          startDate: r.startDate,
          startLocal: r.startLocal,
        })),
      detail: d.records.map((r) => ({
        title: r.title,
        startDate: r.startDate,
        startLocal: r.startLocal,
      })),
    }));
  const fields = fieldSummary(records),
    detailFields = fieldSummary(standalone);
  const error = pages[0]?.error;
  const status = error
    ? error.code
    : records.length || standalone.length
      ? "sample_extracted"
      : "adapter_work_needed";
  let nextWork = error
    ? /access|robots|credentials/.test(error.code)
      ? "Investigate permitted feed/API/access; do not rewrite selectors for an access denial."
      : /rate|transport/.test(error.code)
        ? "Review transport/cooldown evidence before retrying."
        : "Inspect the captured page and repair the listing contract."
    : !records.length && !standalone.length
      ? "Inspect source calendar, embed/feed and dated detail contracts; no usable sample was established."
      : fields.needsDetail || detailFields.needsDetail
        ? "Finish detail acquisition or document unavailable fields; validate occurrence matching and full pagination."
        : "Representative fields are present; validate remaining events, semantics and full pagination before scheduling.";
  if (unmatchedDetails.length)
    nextWork =
      "Resolve the sampled listing/detail identity or date mismatch before merging fields. " +
      nextWork;
  rows.push({
    id: config.id,
    url: config.url,
    group: config.group,
    origin: config.origin,
    adapter: config.adapter,
    browserInspectedAt: source.inspectedAt,
    status,
    detailEnrichmentEnabled: !!config.enrichDetails,
    listingWithSampledEnrichment: fields,
    standaloneDetailSamples: detailFields,
    pages,
    unmatchedDetails,
    nextWork,
    samples: [...records, ...standalone].slice(0, 2).map((r) => ({
      title: r.title,
      url: r.url,
      startDate: r.startDate,
      endDate: r.endDate,
      startLocal: r.startLocal,
      endLocal: r.endLocal,
      dateTimePrecision: r.dateTimePrecision,
      dateTimeBasis: r.dateTimeBasis,
      timeZone: r.timeZone,
      timeZoneBasis: r.timeZoneBasis,
      timeZoneLabel: r.timeZoneLabel,
      location: r.location,
      geoCoordinates: r.geoCoordinates,
      fieldQuality: r.fieldQuality,
      warnings: r.warnings,
    })),
  });
}
const output = resolve(values.output);
await mkdir(resolve(output, ".."), { recursive: true });
const counts = rows.reduce(
  (out, row) => ((out[row.status] = (out[row.status] ?? 0) + 1), out),
  {},
);
const report = {
  generatedAt: new Date().toISOString(),
  build: await buildId(),
  scope:
    "Bounded rendered listing and representative detail inspections; captured-page replay, not complete enumeration or semantic approval",
  inputBuilds,
  counts,
  rows,
};
await writeFile(output + ".json", JSON.stringify(report, null, 2) + "\n");
const lines = [
  "# Events source date, time and location audit",
  "",
  `Generated ${report.generatedAt}. All ${rows.length} supplied entries are accounted for.`,
  "",
  "Each source received a bounded Playwright listing attempt. Accessible sources were inspected through their rendered DOM; a representative same-host detail was visited where discovered. Access/policy failures are recorded, not bypassed. Later focused browser checks replace earlier samples for those sources. The current parsers replay the immutable captures to measure fields.",
  "",
  "**These are samples, not complete crawls or approval of every event.** A date can be known while its exact time is unknown. Missing structured end dates stay null. Coordinates are optional and are never geocoded or inferred from a city. Text locations preserve source claims.",
  "",
  "The listing columns include successful sampled detail enrichment. Separate detail-only discovery samples are shown in the final column. Counts overlap publishers and are not unique events.",
  "",
  "| ID | Group | Source | Outcome | Listing records | Start / end dates | Start / end times | Text location | Coordinates | Standalone detail records |",
  "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const row of rows) {
  const f = row.listingWithSampledEnrichment;
  lines.push(
    `| ${row.id} | ${row.group} | [URL](${row.url}) | ${row.status} | ${f.records} | ${f.startDate} / ${f.endDate} | ${f.startTime} / ${f.endTime} | ${f.textLocation} | ${f.coordinates} | ${row.standaloneDetailSamples.records} |`,
  );
}
lines.push("", "## Per-source follow-up", "");
for (const row of rows) {
  const errors = row.pages.filter((p) => p.error).map((p) => p.error.code);
  lines.push(
    `- **${row.id}** (${row.adapter}): ${row.nextWork}${errors.length ? ` Recorded errors: ${[...new Set(errors)].join(", ")}.` : ""}`,
  );
}
lines.push(
  "",
  "Machine-readable field counts, representative records, capture paths/hashes, inspected selectors and page-level issues are in `source_field_quality.json`. Raw captures remain in ignored local artifact storage. A failed browser attempt does not validate a parser. No schedules or operational repair tickets are changed by this audit.",
  "",
);
await writeFile(output + ".md", lines.join("\n"));
console.log(
  JSON.stringify({
    sources: rows.length,
    counts,
    json: output + ".json",
    markdown: output + ".md",
  }),
);
