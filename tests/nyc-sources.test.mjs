import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { parseApi } from "../src/worker.mjs";
import {
  algoliaRequestUrl,
  zonedDate,
  zonedMidnightEpoch,
} from "../src/adapters/algolia.mjs";

const configs = await registry();
const config = (id) => configs.find((c) => c.id === id);
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("NYC search-index requests carry the as-of midnight in the source time zone", () => {
  const c = config("url-024");
  assert.equal(c.apiFormat, "algolia");
  // Daylight time ends on Nov 1, 2026: Nov 5 midnight is 05:00 UTC, Nov 1 is 04:00 UTC.
  assert.equal(
    zonedMidnightEpoch("2026-11-05", c.timeZone),
    Date.UTC(2026, 10, 5, 5) / 1000,
  );
  assert.equal(
    zonedMidnightEpoch("2026-11-01", c.timeZone),
    Date.UTC(2026, 10, 1, 4) / 1000,
  );
  assert.equal(
    zonedMidnightEpoch("2026-11-02", c.timeZone),
    Date.UTC(2026, 10, 2, 5) / 1000,
  );
  assert.equal(zonedDate(1806033600, c.timeZone), "2027-03-26");
  const url = new URL(algoliaRequestUrl(c, { asOf: "2026-11-05" }));
  assert.equal(url.hostname, new URL(c.apiEndpoint).hostname);
  assert.match(url.searchParams.get("filters"), /endDate >= 1793854800/);
  assert.equal(url.searchParams.get("page"), "0");
  assert.ok(c.allowedHosts.includes(url.hostname));
});

test("NYC Tourism search hits become dated, located observations without detail pages", async () => {
  const c = config("url-024");
  const r = parseApi(
    await fixture("nyc-algolia.json"),
    algoliaRequestUrl(c, { asOf: "2026-11-05" }),
    c,
    { meta: {} },
  );
  assert.equal(r.records.length, 3);
  assert.equal(r.rejected, 0);
  assert.equal(r.terminal, true);
  assert.equal(r.expectedTotal, 3);
  const [auto, open, parade] = r.records;
  assert.equal(auto.startDate, "2027-03-26");
  assert.equal(auto.endDate, "2027-04-04");
  assert.equal(auto.startLocal, null);
  assert.equal(auto.url, "https://www.nyctourism.com/events/new-york-international-auto-show");
  assert.equal(auto.location.venue, "Javits Center");
  assert.equal(auto.location.neighborhood, "Midtown West");
  // A hit without a venue keeps only the published neighborhood label.
  assert.equal(open.location.venue, null);
  assert.equal(open.location.neighborhood, "Citywide");
  assert.equal(parade.startDate, "2026-11-26");
  assert.equal(parade.endDate, "2026-11-26");
  assert.ok(r.records.every((e) => e.sourceRecordId.includes("|")));
});

test("a changed search contract fails closed", () => {
  const c = config("url-024");
  assert.throws(() => parseApi("{}", "https://x.example/", c, { meta: {} }), {
    code: "contract_changed",
  });
  assert.throws(() => parseApi("<html>", "https://x.example/", c, { meta: {} }), {
    code: "contract_changed",
  });
});

test("Javits first month is read from the page payload and chains to the other months", async () => {
  const c = config("url-027");
  const r = parseDocument({
    html: await fixture("javits-calendar.html"),
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].title, "ISC EAST");
  assert.equal(r.records[0].startDate, "2026-11-04");
  assert.equal(r.records[0].endDate, "2026-11-05");
  assert.equal(r.records[0].location.venue, "Jacob K. Javits Convention Center");
  assert.equal(r.terminal, false);
  assert.equal(r.nextRequests.length, 1);
  assert.equal(r.nextRequests[0].meta.monthIndex, 1);
  assert.equal(r.nextRequests[0].meta.monthLabel, "Dec");
  assert.deepEqual(r.nextRequests[0].meta.hidden, ["61230", "60898"]);
});

test("Javits month JSON excludes page-hidden, internal and unconfirmed events and ends at the last month", async () => {
  const c = config("url-027"),
    body = await fixture("javits-month.json"),
    meta = { monthIndex: 2, monthLabel: "Jan '27", months: ["Nov", "Dec", "Jan '27"], hidden: ["61230"] };
  const r = parseDocument({
    html: body,
    url: "https://www.javitscenter.com/api/momentus/events?startDate=2027-01-01&endDate=2027-01-31",
    config: c,
    task: { depth: 0, kind: "listing", meta },
  });
  assert.deepEqual(
    r.records.map((e) => e.title),
    ["AI SUMMIT NEW YORK"],
  );
  assert.deepEqual(r.excluded, { hidden: 1, internal: 1, blackout: 0, unconfirmed: 1 });
  assert.equal(r.terminal, true);
  assert.equal(r.nextRequests.length, 0);
  assert.equal(r.coverage, "verified-list");
  assert.throws(
    () =>
      parseDocument({
        html: '{"nope":1}',
        url: c.url,
        config: c,
        task: { depth: 0, kind: "listing", meta },
      }),
    { code: "contract_changed" },
  );
});

test("DoThis week-format calendar resolves row dates inside the group's own week", async () => {
  const c = config("url-033");
  const r = parseDocument({
    html: await fixture("dothis-street-fairs-week.html"),
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.deepEqual(
    r.records.map((e) => [e.title, e.startDate, e.startLocal, e.endLocal]),
    [
      ["Midtown West Fair", "2026-11-07", "2026-11-07T10:00:00", "2026-11-07T18:00:00"],
      ["Veterans Day Festival", "2026-11-11", "2026-11-11T10:00:00", "2026-11-11T18:00:00"],
    ],
  );
  assert.equal(r.coverage, "verified-list");
  assert.equal(r.terminal, true);
  assert.deepEqual(r.issues, []);
  assert.equal(r.records[0].geoCoordinates.latitude, 40.759764);
});

test("DoThis day-format calendar keeps permit rows at date precision and reconciles counts", async () => {
  const c = config("url-033");
  const html = await fixture("dothis-street-fairs-days.html");
  const r = parseDocument({
    html,
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(r.records.length, 13);
  assert.equal(r.rejected, 0);
  assert.equal(r.terminal, true);
  const permit = r.records.find((e) => e.title === "Annual Play Day");
  assert.equal(permit.startLocal, null);
  assert.ok(permit.warnings.includes("permit_window_not_necessarily_public_hours"));
  // A permit row without its own link is still identified by its title.
  const unlinked = r.records.find((e) => e.title.startsWith("Recordando"));
  assert.match(unlinked.url, /#permit-Recordando/);
  const fair = r.records.find((e) => e.title === "Midtown West Fair");
  assert.equal(fair.startLocal, "2026-11-07T10:00:00");
  // A stated total that disagrees with the rows removes the coverage claim.
  const changed = parseDocument({
    html: html.replace("13 street fairs", "14 street fairs"),
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(changed.coverage, "unverified");
  assert.equal(changed.terminal, false);
  assert.equal(changed.issues[0].code, "street_fair_counts_disagree");
});

test("City Guide cards use link dates only when the card weekday and day agree", async () => {
  const c = config("url-030");
  const r = parseDocument({
    html: await fixture("cityguide-cards.html"),
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.deepEqual(
    r.records.map((e) => [e.title, e.startDate, e.endDate, e.startLocal]),
    [
      ["Mindful Matter Market No. 5", "2026-11-07", "2026-11-08", null],
      ["Elie Tahari Madison Avenue Pop-Up", "2026-10-16", "2026-11-09", null],
      ["Here Bk Psychic Parlor", "2026-11-06", "2026-11-06", "2026-11-06T19:00:00"],
    ],
  );
  assert.deepEqual(r.excluded, { past: 2 });
  assert.equal(r.rejected, 1);
  const conflict = r.issues.find((i) => i.code === "card_date_conflict");
  assert.equal(conflict.count, 1);
  // A multi-day card's time is daily, so it is not turned into a range clock.
  assert.ok(r.records[0].warnings.includes("daily_hours_listed_for_multi_day"));
  assert.equal(r.records[0].location.venue, "Meredith Rosen Gallery");
  // Seven of the 33 stated events are not rendered; coverage is not claimed.
  assert.equal(r.coverage, "unverified");
  assert.equal(r.terminal, false);
  assert.ok(r.issues.some((i) => i.code === "listed_total_not_reconciled"));
});

test("NYC Parks aggregate pages continue until an empty page and then verify coverage", async () => {
  const c = config("url-085");
  const url = "https://www.nycgovparks.org/events/festivals/ajax/aggregate/p1";
  const first = parseDocument({
    html: await fixture("nycparks-aggregate-p1.html"),
    url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(first.records.length, 5);
  assert.equal(first.terminal, false);
  assert.equal(first.coverage, "verified-list");
  assert.deepEqual(first.issues, []);
  assert.equal(
    first.nextRequests[0].url,
    "https://www.nycgovparks.org/events/festivals/ajax/aggregate/p2",
  );
  const empty = parseDocument({
    html: await fixture("nycparks-aggregate-p2.html"),
    url: first.nextRequests[0].url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.terminal, true);
  assert.equal(empty.coverage, "verified-list");
  assert.deepEqual(empty.issues, []);
  // A stated total that differs from the cards is reported.
  const mismatch = parseDocument({
    html: (await fixture("nycparks-aggregate-p1.html")).replace(
      "viewing 5 events",
      "viewing 7 events",
    ),
    url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(mismatch.issues[0].code, "listed_total_not_reconciled");
});
