import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const config = configs.find((c) => c.id === "url-005");
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
const html = await fixture("festivalnet-list");
const url = "https://festivalnet.com/fairs-festivals/Nevada?page=2";
const paged = { kind: "listing", depth: 0, meta: { pagination: true } };

test("FestivalNet registers one list entrypoint per listed state or province", () => {
  assert.equal(config.entrypoints.length, 72);
  assert.equal(new Set(config.entrypoints).size, 72);
  assert.ok(
    config.entrypoints.includes(
      "https://festivalnet.com/fairs-festivals/Alabama",
    ),
  );
  assert.ok(
    config.entrypoints.every((e) =>
      e.startsWith("https://festivalnet.com/fairs-festivals/"),
    ),
  );
});

test("FestivalNet result cards keep source dates, place and numeric identity; the sticky feature is skipped", () => {
  const parsed = parseDocument({ html, url, config, task: paged });
  // Fixture: one sticky featured block, two dated results, one unconfirmed.
  assert.equal(parsed.records.length, 2);
  const [first] = parsed.records;
  assert.equal(first.title, "Magic of Santa Christmas Craft Faire");
  assert.match(first.startDate, /^2026-12-0\d$/);
  assert.match(first.sourceRecordId, /^\d+$/);
  assert.match(first.url, /^https:\/\/festivalnet\.com\/\d+\//);
  assert.equal(first.location.region, "NV");
  assert.ok(!parsed.records.some((r) => /Wumba/.test(r.title)));
  assert.equal(
    parsed.nextRequests.filter((r) => r.kind === "detail").length,
    0,
  );
});

test("FestivalNet follows the next arrow and verifies the active page", () => {
  const parsed = parseDocument({ html, url, config, task: paged });
  assert.equal(parsed.terminal, false);
  assert.equal(parsed.coverage, "verified-list");
  const next = parsed.nextRequests.filter((r) => r.kind === "listing");
  assert.equal(next.length, 1);
  assert.equal(new URL(next[0].url).searchParams.get("page"), "3");
  assert.throws(
    () =>
      parseDocument({
        html,
        url: "https://festivalnet.com/fairs-festivals/Nevada?page=5",
        config,
        task: paged,
      }),
    /requested page 5/,
  );
});

test("FestivalNet ends at the first page without a dated result card", async () => {
  const parsed = parseDocument({
    html: await fixture("festivalnet-unconfirmed"),
    url: "https://festivalnet.com/fairs-festivals/Nevada?page=3",
    config,
    task: paged,
  });
  // Only the sticky feature and "dates not updated" results remain: no
  // records, no further pages, and no guessed dates.
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.nextRequests.length, 0);
});

test("FestivalNet last page has no arrow; a missing list or pager is a contract change", () => {
  const last = html.replace(
    /<li class="prevNext"><a href="\/fairs-festivals\/Nevada\?page=3">.*?<\/li>/s,
    "",
  );
  const done = parseDocument({ html: last, url, config, task: paged });
  assert.equal(done.terminal, true);
  assert.equal(done.nextRequests.length, 0);
  assert.throws(
    () =>
      parseDocument({
        html: html.replaceAll("festiv-list", "other"),
        url,
        config,
        task: paged,
      }),
    /listing contract missing/,
  );
  const single = html.replace(
    /<div class="pagination-section">.*?<\/ul><\/div>/s,
    "",
  );
  assert.equal(
    parseDocument({
      html: single,
      url: "https://festivalnet.com/fairs-festivals/Nevada",
      config,
    }).terminal,
    true,
  );
  assert.throws(
    () => parseDocument({ html: single, url, config, task: paged }),
    /pager missing/,
  );
});
