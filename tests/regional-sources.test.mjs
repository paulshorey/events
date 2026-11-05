import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import {
  parseSeattleDate,
  parseSharePointCalendar,
  parseSitemapEntries,
} from "../src/adapters/regional.mjs";
import { parseApi } from "../src/worker.mjs";

const configs = await registry();
const config = (id) => configs.find((c) => c.id === id);
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("Visit Seattle dates distinguish dated rows from undated ongoing claims", () => {
  assert.equal(parseSeattleDate("11/5/2026").startDate, "2026-11-05");
  const range = parseSeattleDate("4/16/2027 through 4/27/2027");
  assert.deepEqual(
    [range.startDate, range.endDate],
    ["2027-04-16", "2027-04-27"],
  );
  assert.equal(parseSeattleDate("Ongoing").kind, "ongoing");
  const now = parseSeattleDate("Now through 12/31/2027");
  assert.equal(now.kind, "now-through");
  assert.equal(now.startDate, undefined);
  assert.equal(parseSeattleDate("4/27/2027 through 4/16/2027").kind, "unrecognized");
  assert.equal(parseSeattleDate("13/40/2026").kind, "unrecognized");
});

test("Visit Seattle search page: records, exclusions, next page and reconciled total", async () => {
  const c = config("url-059");
  const html = await fixture("visitseattle-search.html");
  const first = parseDocument({
    html,
    url: "https://visitseattle.org/?s=&frm=events",
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(first.observedCount, 4);
  assert.deepEqual(
    first.records.map((r) => [r.title, r.startDate, r.endDate]),
    [
      ["Akira Tana and Otonowa", "2026-11-05", "2026-11-05"],
      ["Seattle Christmas Market", "2026-11-20", "2026-12-24"],
    ],
  );
  assert.equal(first.records[0].location.venue, "The Royal Room");
  assert.deepEqual(first.excluded, {
    nowThroughWithoutStart: 1,
    ongoingWithoutDates: 1,
  });
  assert.equal(first.terminal, false);
  // The publisher prints its own total, so the page belongs to a verifiable list;
  // the run completes only if the final page reconciles it.
  assert.equal(first.coverage, "verified-list");
  assert.equal(first.nextRequests.length, 1);
  assert.equal(first.nextRequests[0].meta.seenBefore, 4);
  assert.equal(first.nextRequests[0].meta.headerTotal, 8);
  // The event pages listed on the page are not crawled; the card already carries the date.
  assert.equal(first.nextRequests.filter((r) => r.kind === "detail").length, 0);
  // A terminal page whose running total matches the publisher's total is verified;
  // a different total is a reported mismatch, never a silent completion.
  const last = html.replace(/<li class="bpn-next-link">.*?<\/li>/s, "");
  const matching = parseDocument({
    html: last,
    url: "https://visitseattle.org/page/2/?s&frm=events",
    config: c,
    task: {
      depth: 0,
      kind: "listing",
      meta: { pagination: true, seenBefore: 4, headerTotal: 8 },
    },
  });
  assert.equal(matching.terminal, true);
  assert.equal(matching.coverage, "verified-list");
  const short = parseDocument({
    html: last,
    url: "https://visitseattle.org/page/2/?s&frm=events",
    config: c,
    task: {
      depth: 0,
      kind: "listing",
      meta: { pagination: true, seenBefore: 3, headerTotal: 8 },
    },
  });
  assert.equal(short.coverage, "unverified");
  assert.deepEqual(
    short.issues.find((i) => i.code === "listing_total_mismatch"),
    { code: "listing_total_mismatch", expected: 8, seen: 7 },
  );
});

test("Visit Seattle archive page: venue/date lines and terminal page without a total", async () => {
  const c = config("url-058");
  const r = parseDocument({
    html: await fixture("visitseattle-archive.html"),
    url: "https://visitseattle.org/events/page/4/",
    config: c,
    task: { depth: 0, kind: "listing", meta: { pagination: true } },
  });
  assert.equal(r.observedCount, 3);
  assert.deepEqual(
    r.records.map((x) => [x.title, x.startDate, x.endDate]),
    [
      ["Swan Lake", "2027-02-05", "2027-02-20"],
      ["Bahamas", "2026-11-03", "2026-11-03"],
    ],
  );
  assert.equal(r.excluded.ongoingWithoutDates, 1);
  assert.equal(r.terminal, true);
  // The archive prints no total, so it never claims a verified enumeration.
  assert.equal(r.coverage, "unverified");
  assert.deepEqual(r.nextRequests, []);
});

test("Visit Seattle page holding only undated ongoing events is accounted for, not an empty contract", async () => {
  const html = (await fixture("visitseattle-archive.html")).replace(
    /<h6>[^<]*<\/h6>\s*<h6>(?!Ongoing)[^<]*<\/h6>/g,
    "<h6>Venue</h6><h6>Ongoing</h6>",
  );
  const r = parseDocument({
    html,
    url: "https://visitseattle.org/events/page/4/",
    config: config("url-058"),
    task: { depth: 0, kind: "listing", meta: { pagination: true } },
  });
  assert.equal(r.records.length, 0);
  assert.equal(r.excluded.ongoingWithoutDates, 3);
  assert.deepEqual(r.issues, []);
});

test("Visit Seattle pages that show no event cards are an issue, not an empty calendar", () => {
  const r = parseDocument({
    html: "<html><body><div class='container-blog-pagination'></div></body></html>",
    url: "https://visitseattle.org/events/page/5/",
    config: config("url-058"),
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(r.records.length, 0);
  assert.ok(r.issues.some((i) => i.code === "expected_source_cards_missing"));
});

test("SharePoint calendar converts UTC instants to the collection time zone", async () => {
  const c = config("url-072");
  const body = await fixture("sharepoint-city-calendar.json");
  const r = parseSharePointCalendar({
    body,
    url: "https://dallascityhall.com/calendar/_api/Web/Lists/GetByTitle('City%20Calendar')/items",
    config: c,
  });
  assert.equal(r.records.length, 4);
  assert.equal(r.rejected, 0);
  assert.equal(r.coverage, "api-query");
  assert.equal(r.terminal, true);
  const [hearing, ceremony, allDay, recurring] = r.records;
  // 2026-11-06T00:00Z is 6 p.m. on Nov 5 in CST (UTC-6, DST ended Nov 1).
  assert.equal(hearing.startLocal, "2026-11-05T18:00:00");
  assert.equal(hearing.startDate, "2026-11-05");
  assert.equal(hearing.endLocal, "2026-11-05T19:00:00");
  assert.equal(hearing.location.venue, "Arlington Park Recreation Center");
  assert.equal(hearing.location.postalCode, "75235");
  assert.equal(
    hearing.url,
    "https://dallascityhall.com/calendar/Pages/Event-Details.aspx?EID=3269",
  );
  assert.equal(ceremony.startLocal, "2026-11-06T09:00:00");
  // The all-day item has a visible date but no invented clock times.
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.startLocal, null);
  assert.equal(allDay.startDate, "2026-12-05");
  assert.equal(allDay.endDate, "2026-12-05");
  // 2026-07-14T23:00Z is 6 p.m. CDT (UTC-5).
  assert.equal(recurring.startLocal, "2026-07-14T18:00:00");
  assert.ok(recurring.warnings.includes("recurring_series_item_not_expanded"));
});

test("SharePoint calendar follows the odata next link and rejects unexpected bodies", () => {
  const c = config("url-072");
  const page = parseSharePointCalendar({
    body: JSON.stringify({
      value: [],
      "odata.nextLink": "https://dallascityhall.com/calendar/_api/x?$skiptoken=1",
    }),
    url: "https://dallascityhall.com/calendar/_api/x",
    config: c,
  });
  assert.equal(page.terminal, false);
  assert.equal(page.nextRequests[0].kind, "api");
  assert.throws(
    () =>
      parseSharePointCalendar({
        body: "<feed/>",
        url: "https://dallascityhall.com/calendar/_api/x",
        config: c,
      }),
    { code: "contract_changed" },
  );
  assert.throws(
    () =>
      parseSharePointCalendar({
        body: "{}",
        url: "https://dallascityhall.com/calendar/_api/x",
        config: c,
      }),
    { code: "contract_changed" },
  );
});

test("sitemap discovery keeps only unique event-page URLs and stays unverified", async () => {
  const c = config("url-056");
  const r = parseApi(
    await fixture("sitemap-events.xml"),
    "https://www.miamiandbeaches.com/sitemap.xml",
    c,
    { kind: "api", depth: 0, meta: {} },
  );
  assert.deepEqual(
    r.nextRequests.map((x) => [x.url, x.kind]),
    [
      ["https://www.miamiandbeaches.com/event/1920s-christmas-cabaret/43480", "detail"],
      ["https://www.miamiandbeaches.com/event/miami-open/9285", "detail"],
    ],
  );
  assert.equal(r.coverage, "unverified");
  assert.equal(r.terminal, false);
  assert.throws(
    () =>
      parseSitemapEntries({
        body: "<html></html>",
        url: "https://www.miamiandbeaches.com/sitemap.xml",
        config: c,
      }),
    { code: "contract_changed" },
  );
});

test("regional source entrypoints are templated and bound to their adapters", () => {
  const sp = config("url-072");
  assert.equal(sp.entrypoints[0].kind, "api");
  assert.match(sp.entrypoints[0].url, /datetime'\{asOf\}T00:00:00'/);
  assert.equal(sp.apiHeaders.Accept, "application/json;odata=nometadata");
  for (const id of ["url-058", "url-059", "url-060", "url-086"]) {
    assert.equal(config(id).adapter, "visitseattle");
    assert.equal(config(id).discoverDetails, false);
  }
  assert.equal(config("url-070").apiMode, "sitemap");
  assert.equal(config("url-056").apiMode, "sitemap");
});
