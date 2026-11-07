import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
const detailTask = { kind: "detail", depth: 1, meta: {} };

test("Meet Me at the Fair enumerates the ItemList directory and reconciles its declared count", async () => {
  const config = configs.find((c) => c.id === "url-009"),
    html = await fixture("meetmeatthefair-all"),
    url = config.url;
  const parsed = parseDocument({ html, url, config });
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.coverage, "verified-list");
  assert.equal(parsed.expectedTotal, 3);
  assert.equal(parsed.records.length, 0);
  const details = parsed.nextRequests.filter((r) => r.kind === "detail");
  assert.deepEqual(details.map((r) => new URL(r.url).pathname).sort(), [
    "/events/arts-center-east-holiday-artisan-craft-fair-2026",
    "/events/berlin-fair-ct-2027",
    "/events/zoolights-at-stone-zoo-2026",
  ]);
  // Navigation, state and facet links are not events.
  assert.equal(parsed.nextRequests.length, 3);
  assert.throws(
    () =>
      parseDocument({
        html: html.replace('"numberOfItems":3', '"numberOfItems":4'),
        url,
        config,
      }),
    /disagree/,
  );
  assert.throws(
    () =>
      parseDocument({
        html: html.replace(/application\/ld\+json/g, "text/plain"),
        url,
        config,
      }),
    /contract missing/,
  );
});

test("Meet Me at the Fair detail pages accept the canonical alias and keep the tentative flag", async () => {
  const config = configs.find((c) => c.id === "url-009"),
    html = await fixture("meetmeatthefair-detail"),
    url = "https://meetmeatthefair.com/events/berlin-fair-ct-2027";
  const parsed = parseDocument({ html, url, config, task: detailTask });
  assert.equal(parsed.records.length, 1);
  const [r] = parsed.records;
  assert.equal(r.url, url);
  assert.equal(r.startDate, "2027-09-16");
  assert.equal(r.endDate, "2027-09-19");
  assert.equal(r.location.locality, "Berlin");
  assert.ok(r.warnings.includes("source_marks_event_tentative"));
  // Without the alias contract, a differing Event URL is rejected as before.
  const strict = parseDocument({
    html,
    url,
    config: { ...config, detailEventUrlAlias: false },
    task: detailTask,
  });
  assert.equal(strict.records.length, 0);
  // Without the banner the flag is absent.
  const clean = parseDocument({
    html: html.replace(
      /This event has not yet been verified by our team/,
      "Verified",
    ),
    url,
    config,
    task: detailTask,
  });
  assert.ok(
    !clean.records[0].warnings.includes("source_marks_event_tentative"),
  );
});

test("Meet Me at the Fair series pages count only when the series carries its own start date", async () => {
  const config = configs.find((c) => c.id === "url-009"),
    url = "https://meetmeatthefair.com/events/biddeford-gun-show";
  const dated = parseDocument({
    html: await fixture("meetmeatthefair-series"),
    url,
    config,
    task: detailTask,
  });
  // Only the series' upcoming occurrence; the nested 2026 edition has another
  // URL and is never turned into a record of this page.
  assert.equal(dated.records.length, 1);
  assert.equal(dated.records[0].startDate, "2027-05-15");
  assert.equal(dated.records[0].endDate, "2027-05-16");
  assert.equal(dated.records[0].url, url);
  const off = parseDocument({
    html: await fixture("meetmeatthefair-series"),
    url,
    config: { ...config, detailSeriesAsEvent: false },
    task: detailTask,
  });
  assert.equal(off.records.length, 0);
  // A series announcing no date yields no record and says why, never a guess.
  const undated = parseDocument({
    html: await fixture("meetmeatthefair-undated-series"),
    url: "https://meetmeatthefair.com/events/207-beer-week",
    config,
    task: detailTask,
  });
  assert.equal(undated.records.length, 0);
  assert.ok(
    undated.issues.some((i) => i.code === "detail_event_fields_unavailable"),
  );
});
