import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseApi } from "../src/worker.mjs";
import { parseDocument } from "../src/adapters/document.mjs";

const configs = await registry();
const config = (id, extra = {}) => ({
  ...configs.find((c) => c.id === id),
  asOf: "2026-11-05",
  ...extra,
});
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("UChicago Live JSON keeps all-day entries date-only and timed entries local", async () => {
  const c = config("url-096"),
    url = c.entrypoints[0].url;
  const r = parseApi(await fixture("uchicago-live.json"), url, c, {});
  assert.equal(r.coverage, "api-query");
  assert.equal(r.expectedTotal, 1230);
  assert.equal(r.terminal, false);
  assert.equal(r.records.length, 3);
  const allDay = r.records.find((x) => x.allDay === true);
  assert.equal(allDay.startDate, "2026-11-05");
  assert.equal(allDay.startLocal, null);
  assert.equal(allDay.timeZone, "America/Chicago");
  const timed = r.records.find((x) => x.title.startsWith("Pierre Bismuth"));
  assert.equal(timed.startLocal, "2026-11-05T09:00:00-06:00");
  assert.equal(timed.location.formattedAddress, timed.location.venue ?? timed.location.formattedAddress);
  assert.match(timed.location.formattedAddress, /Neubauer/);
  const online = r.records.find((x) => x.title.startsWith("Hands-On"));
  assert.ok(online.warnings.includes("online_or_hybrid_event"));
  // Same event, different occurrence: identity includes the occurrence time.
  assert.match(online.sourceRecordId, /^\d+\|2026-11-05T09:30:00-06:00$/);
  assert.equal(r.nextRequests.length, 1);
  assert.equal(r.nextRequests[0].kind, "api");
  assert.match(r.nextRequests[0].url, /response_fields\/location,event_types,tags\?page=2$/);
});

test("Live JSON stops at the last page and rejects changed envelopes or foreign next links", async () => {
  const c = config("url-096"),
    url = c.entrypoints[0].url,
    body = JSON.parse(await fixture("uchicago-live.json"));
  const last = parseApi(
    JSON.stringify({ ...body, meta: { ...body.meta, page: 13 }, links: { ...body.links, next: null } }),
    url,
    c,
    {},
  );
  assert.equal(last.terminal, true);
  assert.deepEqual(last.nextRequests, []);
  assert.throws(() => parseApi("{}", url, c, {}), { code: "contract_changed" });
  assert.throws(() => parseApi("<html>", url, c, {}), { code: "contract_changed" });
  assert.throws(
    () =>
      parseApi(
        JSON.stringify({ ...body, links: { next: "https://evil.example/live/json/events?page=2" } }),
        url,
        c,
        {},
      ),
    { code: "contract_changed" },
  );
});

test("Houston iCalendar feed excludes past events, maps zones and unfolds lines", async () => {
  const c = config("url-045"),
    url = c.entrypoints[0].url;
  const r = parseApi(await fixture("houston-city.ics"), url, c, {});
  assert.equal(r.excluded.pastEvents, 1);
  assert.equal(r.records.length, 2);
  const show = r.records.find((x) => x.title.startsWith("Why You Like It"));
  assert.equal(show.startLocal, "2026-11-06T19:30:00");
  assert.equal(show.endLocal, "2026-11-06T21:45:00");
  assert.equal(show.timeZone, "America/Chicago");
  assert.equal(show.timeZoneLabel, "Central Standard Time");
  assert.equal(show.location.venue, "Miller Outdoor Theatre");
  assert.equal(show.location.formattedAddress, "Miller Outdoor Theatre, 6000 Hermann Park Drive");
  assert.equal(show.raw.mapUrl, "https://goo.gl/maps/er3jcSMrC7fNsjoCA");
  assert.match(show.url, /^https:\/\/www\.houstontx\.gov\/events\/#ics-event=[0-9a-f]{16}$/);
  // DTEND of a DATE value is exclusive: a one-day holiday ends the same day.
  const holiday = r.records.find((x) => x.title === "City Holiday");
  assert.equal(holiday.allDay, true);
  assert.equal(holiday.startDate, "2026-11-11");
  assert.equal(holiday.endDate, "2026-11-11");
  assert.equal(holiday.startLocal, null);
  assert.equal(r.terminal, true);
  assert.deepEqual(r.issues, []);
});

test("iCalendar events with an unknown TZID are reported rather than converted by guesswork", async () => {
  const c = config("url-045"),
    url = c.entrypoints[0].url;
  const text = (await fixture("houston-city.ics")).replace(
    "DTSTART;TZID=Central Standard Time:20261106T193000",
    "DTSTART;TZID=Mystery Standard Time:20261106T193000",
  );
  const r = parseApi(text, url, c, {});
  assert.equal(r.records.length, 1);
  assert.ok(r.issues.some((i) => i.code === "events_with_unmapped_time_zone"));
  assert.throws(() => parseApi("not a calendar", url, c, {}), { code: "contract_changed" });
});

test("houston.com converts the structured UTC instant to venue-local time and ignores a zero-length end", async () => {
  const c = config("url-047");
  const r = parseDocument({
    html: await fixture("houston-com-event.html"),
    url: "https://houston.com/events/bowling-for-soup-zu74h1ok",
    config: c,
    task: { depth: 1, kind: "detail", meta: {} },
  });
  assert.equal(r.records.length, 1);
  const e = r.records[0];
  // 2026-11-06T00:30Z is 6:30 PM on November 5 in Central time.
  assert.equal(e.startDate, "2026-11-05");
  assert.equal(e.startLocal, "2026-11-05T18:30:00");
  assert.equal(e.endLocal, null);
  assert.equal(e.endDate, null);
  assert.equal(e.timeZone, "America/Chicago");
  assert.ok(e.warnings.includes("utc_instant_converted_to_collection_time_zone"));
  assert.equal(e.raw.sourceUtc.startDate, "2026-11-06T00:30:00.000Z");
  assert.equal(e.location.venue, "House of Blues Houston");
  assert.equal(e.geoCoordinates.latitude, 29.75377797);
});

test("the houston.com sitemap yields only event detail tasks and never claims completeness", async () => {
  const c = config("url-047");
  const r = parseApi(
    await fixture("houston-com-sitemap.xml"),
    "https://houston.com/events-sitemap.xml",
    c,
    {},
  );
  assert.equal(r.records.length, 0);
  assert.equal(r.coverage, "discovery");
  assert.equal(r.terminal, false);
  assert.ok(r.nextRequests.length >= 2);
  for (const n of r.nextRequests) {
    assert.equal(n.kind, "detail");
    assert.match(new URL(n.url).pathname, /^\/events\/[a-z0-9]/);
  }
  assert.ok(!r.nextRequests.some((n) => /not-an-event|\/events$/.test(n.url)));
  assert.throws(() => parseApi("<html></html>", "https://houston.com/x.xml", c, {}), {
    code: "contract_changed",
  });
});

test("Chicago Parks listing: yearless cards become detail tasks, never guessed years", async () => {
  const c = config("url-042");
  const html = await fixture("chicago-parks-page.html");
  const r = parseDocument({
    html,
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(r.rejected, 0);
  assert.equal(r.observedCount, 3);
  assert.equal(r.records.length, 0);
  const details = r.nextRequests.filter((n) => n.kind === "detail");
  assert.equal(details.length, 3);
  assert.ok(details.every((d) => d.meta.undatedListing));
  assert.equal(details[0].meta.listingDate, "Nov 5");
  // Page 0 with a next link is verified but not terminal.
  assert.equal(r.coverage, "verified-list");
  assert.equal(r.terminal, false);
  assert.ok(r.nextRequests.some((n) => n.kind === "listing" && /page=1$/.test(n.url)));
});

test("Chicago Parks pager: the last page is terminal and a page mismatch fails closed", async () => {
  const c = config("url-042");
  const html = await fixture("chicago-parks-page.html");
  const noNext = html.replace(/<li class="page-item pager__item--next">.*?<\/li>/s, "");
  const last = parseDocument({
    html: noNext,
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.equal(last.terminal, true);
  assert.equal(last.coverage, "verified-list");
  // The server ignored ?page=7 and served the first page again.
  const mismatch = parseDocument({
    html,
    url: `${c.url}?page=7`,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.notEqual(mismatch.coverage, "verified-list");
  assert.equal(mismatch.terminal, false);
  assert.ok(mismatch.issues.some((i) => i.code === "pager_contract_unverified"));
});

test("Chicago Parks detail states the year and clock; a conflicting calendar link is flagged", async () => {
  const c = config("url-042");
  const html = await fixture("chicago-parks-detail.html");
  const url = "https://www.chicagoparkdistrict.com/events/dancing-on-the-spot-berger";
  const r = parseDocument({
    html,
    url,
    config: c,
    task: { depth: 1, kind: "detail", meta: {} },
  });
  assert.equal(r.records.length, 1);
  const e = r.records[0];
  assert.equal(e.startDate, "2026-11-07");
  assert.equal(e.startLocal, "2026-11-07T19:30:00");
  assert.equal(e.endLocal, "2026-11-07T21:00:00");
  assert.equal(e.location.venue, "Berger (Albert) Park");
  assert.equal(e.location.postalCode, "60660");
  assert.deepEqual(
    e.categoryTags.map((t) => t.label),
    ["Dance", "Night Out in the Parks"],
  );
  assert.equal(e.raw.fee, "$15.00");
  assert.deepEqual(e.warnings, []);
  const changed = html.replace("Saturday, 7:30 PM - 9:00 PM", "Saturday, 8:30 PM - 9:00 PM");
  const conflict = parseDocument({
    html: changed,
    url,
    config: c,
    task: { depth: 1, kind: "detail", meta: {} },
  }).records[0];
  assert.ok(conflict.warnings.includes("calendar_link_conflicts_with_visible_datetime"));
  // An overnight clock range is not given an invented end date.
  const overnight = parseDocument({
    html: html.replace("Saturday, 7:30 PM - 9:00 PM", "Saturday, 10:00 PM - 1:00 AM"),
    url,
    config: c,
    task: { depth: 1, kind: "detail", meta: {} },
  }).records[0];
  assert.equal(overnight.endLocal, null);
  assert.ok(overnight.warnings.includes("end_time_requires_date_review"));
});
