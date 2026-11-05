import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { parseApi } from "../src/worker.mjs";
import { eventsDcApiUrl } from "../src/adapters/eventsdc.mjs";
import { laCityApiUrl } from "../src/adapters/lacity.mjs";

const configs = await registry();
const config = (id) => configs.find((c) => c.id === id);
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("washington.org listing cards: titles, ongoing 'Now' ranges and verified pager", async () => {
  const c = { ...config("url-049"), asOf: "2026-11-05" },
    html = await fixture("dc-tourism-listing.html"),
    url = "https://washington.org/find-dc-listings/events?page=30";
  const r = parseDocument({ html, url, config: c });
  assert.equal(r.method, "dc-listing-cards");
  assert.equal(r.records.length, 3);
  const by = (t) => r.records.find((x) => x.title.startsWith(t));
  // h6.label is truncated; the full title is taken from .card-text only when
  // that text starts with the visible stem.
  assert.equal(
    by("National Symphony").title,
    "National Symphony Orchestra: Serenades & Simple Songs",
  );
  assert.equal(by("National Symphony").startDate, "2026-11-12");
  assert.equal(by("National Symphony").startLocal, null);
  // "Now - Dec 30, 2026": the collection date is a labelled lower bound.
  const ongoing = by("Gentle Yoga");
  assert.equal(ongoing.startDate, "2026-11-05");
  assert.equal(ongoing.endDate, "2026-12-30");
  assert.ok(
    ongoing.warnings.includes(
      "start_date_is_collection_date_listing_says_now",
    ),
  );
  assert.match(ongoing.dateTimeBasis.start, /Now/);
  // Pagination: the active item must agree with ?page=, and rel=next continues.
  assert.equal(r.coverage, "verified-list");
  assert.equal(r.terminal, false);
  assert.deepEqual(
    r.nextRequests.map((n) => n.url),
    ["https://washington.org/find-dc-listings/events?page=31"],
  );
  assert.throws(
    () =>
      parseDocument({
        html,
        url: "https://washington.org/find-dc-listings/events?page=7",
        config: c,
      }),
    { code: "pagination_changed" },
  );
  // Without as-of context an ongoing card is rejected, never given a guessed start.
  const noAsOf = parseDocument({ html, url, config: { ...c, asOf: undefined } });
  assert.equal(noAsOf.records.length, 2);
  assert.equal(noAsOf.rejected, 1);
  // No next link ends the listing.
  const last = parseDocument({
    html: html.replace(/<li class="pager__item pager__item--next">.*?<\/li>/s, ""),
    url,
    config: c,
  });
  assert.equal(last.terminal, true);
  assert.equal(last.nextRequests.length, 0);
});

test("Events DC API: wall-clock timestamps, venue ids and the as-of window", async () => {
  const c = config("url-051"),
    body = await fixture("eventsdc-api.json");
  assert.equal(
    eventsDcApiUrl(c, "2026-11-05"),
    "https://eventsdc.com/api/events?field_end_date_value=2026-11-05+0%3A0%3A0&field_start_date_value=2030-11-05+23%3A59%3A59",
  );
  const r = parseApi(body, eventsDcApiUrl(c, "2026-11-05"), c, {});
  assert.equal(r.records.length, 3);
  assert.equal(r.terminal, true);
  assert.equal(r.expectedTotal, 3);
  const sfn = r.records.find((x) => x.sourceRecordId === "2829");
  assert.equal(sfn.url, "https://eventsdc.com/node/2829");
  assert.equal(sfn.startLocal, "2026-11-14T07:00:00");
  assert.equal(sfn.location.venue, "Walter E. Washington Convention Center");
  assert.ok(sfn.warnings.includes("end_time_may_be_day_boundary"));
  const noVenue = r.records.find((x) => x.sourceRecordId === "150820");
  assert.equal(noVenue.location, null);
  assert.throws(() => parseApi("{}", "https://eventsdc.com/api/events", c, {}), {
    code: "contract_changed",
  });
});

test("sf.gov API: offsets from the source, no padded ends, bad end omitted, paging by total", async () => {
  const c = config("url-066"),
    body = await fixture("sfgov-api.json"),
    url = c.entrypoints[0].url;
  const r = parseApi(body, url, c, {});
  assert.equal(r.records.length, 3);
  assert.equal(r.rejected, 0);
  const meeting = r.records.find((x) => /^[^|]+\|/.test(x.sourceRecordId) && x.categoryTags[0].label === "Meeting" && !x.title.startsWith("District 1"));
  // The API pads end_datetime to 23:59:59; it is not an end time.
  assert.equal(meeting.endLocal, null);
  assert.match(meeting.startLocal, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[78]:00$/);
  assert.ok(meeting.url.startsWith("https://www.sf.gov/"));
  const bad = r.records.find((x) => x.title.startsWith("District 1"));
  assert.equal(bad.endDate, null);
  assert.ok(bad.warnings.includes("source_end_before_start_omitted"));
  // total 3 fits in one page of ten: terminal, no further request (page 17 of
  // the real list is HTTP 404, so the last page must be recognized).
  assert.equal(r.terminal, true);
  assert.equal(r.nextRequests.length, 0);
  const more = parseApi(
    body.replace('"total": 3', '"total": 25'),
    url,
    c,
    {},
  );
  assert.equal(more.terminal, false);
  assert.match(more.nextRequests[0].url, /page=2/);
});

test("LA City calendar feed: offset paging and recurring occurrences keep distinct identities", async () => {
  const c = config("url-036"),
    body = await fixture("lacity-calendar-api.json");
  assert.equal(
    laCityApiUrl(c, "2026-11-05", 30),
    "https://api.lacity.org/city_calendar?_format=json&display_id=rest_export&start=2026-11-05&items_per_page=15&offset=30",
  );
  const r = parseApi(body, laCityApiUrl(c, "2026-11-05"), c, {});
  assert.equal(r.rejected, 0);
  const recurring = r.records.filter((x) => x.title === "Recurring workshop");
  assert.equal(recurring.length, 2);
  assert.notEqual(recurring[0].sourceRecordId, recurring[1].sourceRecordId);
  assert.match(recurring[0].startLocal, /-08:00$/);
  assert.equal(recurring[0].endDate, recurring[0].startDate);
  const meeting = r.records.find((x) => x.sourceRecordId.startsWith("509771"));
  // Meetings repeat the start as the end; that is not an end.
  assert.equal(meeting.endLocal, null);
  // Fewer than one full page ends the listing.
  assert.equal(r.terminal, true);
  const full = parseApi(
    JSON.stringify(Array(15).fill(JSON.parse(body)[1])),
    laCityApiUrl(c, "2026-11-05"),
    c,
    {},
  );
  assert.equal(full.terminal, false);
  assert.match(full.nextRequests[0].url, /offset=15/);
});

test("SF Travel portal is verified only when 'N found' matches the rendered rows", async () => {
  const c = config("url-065"),
    html = await fixture("sf-portal-form.html");
  const ok = parseDocument({ html, url: c.url, config: { ...c, maxDepth: 0 } });
  assert.equal(ok.records.length, 2);
  assert.equal(ok.coverage, "verified-list");
  assert.equal(ok.terminal, true);
  const hotel = ok.records.find((r) => r.raw.venueType === "Hotel");
  assert.equal(hotel.location, null);
  assert.ok(ok.records.some((r) => r.location?.venue === "Moscone Center"));
  assert.ok(ok.records.every((r) => r.raw.organizer));
  const mismatch = parseDocument({
    html: html.replace("2 found", "3 found"),
    url: c.url,
    config: { ...c, maxDepth: 0 },
  });
  assert.notEqual(mismatch.coverage, "verified-list");
  assert.deepEqual(mismatch.issues.map((i) => i.code), [
    "single_page_contract_unverified",
  ]);
});
