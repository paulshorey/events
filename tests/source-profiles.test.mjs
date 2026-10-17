import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { eventRecord } from "../src/records.mjs";
const configs = await registry();
for (const [id, name, start, end] of [
  ["024", "nyc-tourism", "2027-03-26", "2027-04-04"],
  ["079", "orlando", "2026-10-16", "2026-10-16"],
  ["080", "downtown-orlando", "2026-10-16", "2026-10-16"],
  ["082", "san-diego", "2026-10-16", "2026-10-20"],
  ["065", "sf-portal", "2026-10-19", "2026-10-22"],
  ["014", "trade-table", "2026-10-16", "2026-10-19"],
  ["042", "chicago-parks", "2026-04-25", "2026-10-31"],
  ["007", "festivalindex", "2027-04-02", "2027-04-04"],
  ["049", "dc-tourism", "2026-10-16", "2026-10-16"],
])
  test(`${name} extracts inspected card fixtures and preserves date boundaries`, async () => {
    const c = configs.find((c) => c.id === `url-${id}`),
      html = await readFile(
        new URL(`fixtures/${name}.html`, import.meta.url),
        "utf8",
      );
    const r = parseDocument({
      html,
      url: c.url,
      config: { ...c, maxDepth: 0 },
    });
    assert.equal(r.records.length, id === "042" ? 1 : 2);
    assert.equal(r.rejected, id === "042" ? 1 : 0);
    assert.equal(r.records[0].startDate, start);
    assert.equal(r.records[0].endDate, end);
    for (const e of r.records) {
      assert.equal(e.collectionId, c.id);
      assert.equal(e.marketCity, c.cityMarket);
      assert.equal(e.schemaVersion, 3);
    }
    assert.notEqual(r.coverage, "verified-list");
  });
test("ISO timestamps retain their separate end date and invalid explicit ends are rejected", () => {
  const c = configs[0],
    input = {
      title: "An overnight event",
      url: "https://example.com/e",
      startDate: "2026-10-16T23:00:00-04:00",
      endDate: "2026-10-17T01:00:00-04:00",
    };
  const r = eventRecord(c, input, { url: c.url });
  assert.equal(r.endDate, "2026-10-17");
  assert.equal(r.endLocal, input.endDate);
  assert.equal(
    eventRecord(
      c,
      { ...input, endDate: "2026-02-30T01:00:00Z" },
      { url: c.url },
    ),
    null,
  );
});
