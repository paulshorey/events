import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
const venue =
  "https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center";

test("Convention Calendar venue pages parse calendar-day cards and queue each month in the menu", async () => {
  const c = configs.find((c) => c.id === "url-028");
  const page = parseDocument({
    html: await fixture("conventioncalendar-venue"),
    url: venue,
    config: c,
  });
  assert.equal(page.records.length, 2);
  assert.equal(page.rejected, 0);
  assert.equal(page.coverage, "verified-list");
  const first = page.records[0];
  assert.equal(first.title, "Isc East");
  assert.equal(first.startDate, "2026-11-04");
  assert.equal(first.endDate, "2026-11-05");
  // The detail JSON-LD times are placeholders and are not used.
  assert.equal(first.startLocal, null);
  assert.equal(first.location.venue, "Jacob Javits Center");
  assert.equal(first.location.locality, "New York City");
  assert.equal(first.location.region, "NY");
  assert.equal(first.location.country, "US");
  assert.equal(first.sourceRecordId, "conventioncalendar:420402|2026-11-04");
  assert.equal(first.categoryTags[0].label, "Public Event");
  const months = page.nextRequests.map((r) => r.url);
  assert.equal(months.length, 10);
  assert.ok(months.includes(`${venue}?date=2026-12-01`));
  assert.ok(months.includes(`${venue}?date=2028-03-01`));
  // Detail pages are never fetched for this adapter.
  assert.equal(
    page.nextRequests.some((r) => r.kind === "detail"),
    false,
  );
});

test("a requested month that the page does not display fails closed", async () => {
  const c = configs.find((c) => c.id === "url-028");
  const html = await fixture("conventioncalendar-venue");
  assert.throws(
    () => parseDocument({ html, url: `${venue}?date=2027-01-01`, config: c }),
    (e) => e.code === "pagination_changed",
  );
  // The displayed month matches its own request.
  assert.doesNotThrow(() =>
    parseDocument({ html, url: `${venue}?date=2026-11-01`, config: c }),
  );
});

test("the destinations index queues city pages only for the hub", async () => {
  const html = await fixture("conventioncalendar-destinations");
  const hub = configs.find((c) => c.id === "url-015");
  const index = parseDocument({
    html,
    url: "https://conventioncalendar.com/destinations",
    config: hub,
  });
  assert.equal(index.records.length, 0);
  assert.deepEqual(
    index.nextRequests.map((r) => r.url).sort(),
    [
      "https://conventioncalendar.com/destinations?page=2",
      "https://conventioncalendar.com/us/nv/las-vegas",
      "https://conventioncalendar.com/us/pa/pittsburgh",
      "https://conventioncalendar.com/us/tx/san-antonio",
    ].sort(),
  );
  const venueOnly = parseDocument({
    html,
    url: "https://conventioncalendar.com/destinations",
    config: configs.find((c) => c.id === "url-090"),
  });
  assert.deepEqual(
    venueOnly.nextRequests.map((r) => r.url),
    ["https://conventioncalendar.com/destinations?page=2"],
  );
});
