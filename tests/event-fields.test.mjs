import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registry } from "../src/registry.mjs";
import {
  eventRecord,
  recordFromJsonLd,
  jsonLdEvents,
  safeUrl,
} from "../src/records.mjs";
import { coordinates, mergeDetail } from "../src/event-fields.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { Journal } from "../src/storage/journal.mjs";
import { work, optionsFor, parseApi } from "../src/worker.mjs";

const configs = await registry(),
  // These tests exercise the generic detail-enrichment path with the AllEvents
  // profile; the production url-002 entry now collects city lists instead.
  config = {
    ...configs.find((c) => c.id === "url-002"),
    entrypoints: undefined,
    pagination: undefined,
    enrichDetails: true,
    discoverDetails: undefined,
    maxDepth: 2,
  };
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
const evidence = { url: config.url };
const input = {
  title: "Evening social",
  url: "https://allevents.in/event/1",
  startDate: "2026-10-17T18:00:00-05:00",
};

test("every event has separate date boundaries, text location and coordinate properties; unknown end stays unknown", () => {
  const r = eventRecord(config, input, evidence);
  assert.equal(r.startDate, "2026-10-17");
  assert.equal(r.startLocal, input.startDate);
  assert.equal(r.endDate, null);
  assert.equal(r.endLocal, null);
  assert.equal(r.location, null);
  assert.equal(r.geoCoordinates, null);
  assert.equal(r.dateTimePrecision.end, "unknown");
  assert.ok(r.fieldQuality.missing.includes("end_date"));
  assert.ok(r.warnings.includes("end_date_not_supplied"));
});

test("captured AllEvents detail preserves real coordinates, postal address and exact start/end timestamps", async () => {
  const html = await fixture("allevents-detail"),
    event = jsonLdEvents(html).events[0].event;
  const r = recordFromJsonLd(config, event, evidence);
  assert.deepEqual(r.geoCoordinates, {
    latitude: 36.1313039,
    longitude: -86.76156689999999,
  });
  assert.equal(r.location.venue, "The Fairgrounds Nashville");
  assert.equal(r.location.locality, "Nashville");
  assert.equal(r.location.region, "TN");
  assert.equal(r.location.country, "US");
  assert.equal(r.location.postalCode, "37203");
  assert.match(r.location.streetAddress, /625 Smith Ave/);
  assert.equal(r.startLocal, "2026-10-17T12:00:00-05:00");
  assert.equal(r.endLocal, "2026-10-17T18:00:00-05:00");
  assert.deepEqual(r.fieldQuality.missing, []);
});

test("verified AllEvents domain preserves the displayed CDT clock instead of trusting conflicting UTC markup", async () => {
  const url = "https://all.events/go/80002894423001";
  const parsed = parseDocument({
    html: await fixture("allevents-new-domain-detail"),
    url,
    config,
    task: { kind: "detail" },
  });
  assert.equal(parsed.records.length, 1);
  const r = parsed.records[0];
  assert.equal(r.startLocal, "2026-10-17T12:00:00");
  assert.equal(r.endLocal, "2026-10-17T18:00:00");
  assert.equal(r.timeZone, null);
  assert.equal(r.timeZoneLabel, "CDT");
  assert.equal(r.fieldQuality.needsReview, true);
  assert.equal(r.raw.structured.startDate, "2026-10-17T12:00:00.000Z");
  assert.deepEqual(r.geoCoordinates, {
    latitude: 36.1313039,
    longitude: -86.76156689999999,
  });
});

test("detail acquisition accepts an explicitly verified host and excludes unrelated hosts", () => {
  const c = { ...config, maxDepth: 1, enrichDetails: true };
  const item = (url) => ({
    ...input,
    "@type": "Event",
    name: input.title,
    url,
    startDate: "2026-10-17",
    endDate: "2026-10-17",
  });
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify([
      item("https://all.events/go/1"),
      item("https://unrelated.example/e/2"),
    ]) +
    "</script>";
  const parsed = parseDocument({ html, url: c.url, config: c });
  assert.ok(
    parsed.nextRequests.some(
      (r) => r.url === "https://all.events/go/1" && r.meta.enrichRecordIds,
    ),
  );
  assert.equal(
    parsed.nextRequests.some((r) => r.url.includes("unrelated.example")),
    false,
  );
});

test("coordinates reject missing/invalid values and keep real zero values without geocoding", () => {
  for (const c of [
    { latitude: "", longitude: "" },
    { latitude: null, longitude: null },
    { latitude: true, longitude: 20 },
    { latitude: 91, longitude: 10 },
    { latitude: 20, longitude: -181 },
    { latitude: "12 north", longitude: 20 },
    { latitude: 20 },
  ])
    assert.equal(coordinates(c), null);
  assert.deepEqual(coordinates({ latitude: "0", longitude: 0 }), {
    latitude: 0,
    longitude: 0,
  });
  const r = eventRecord(
    config,
    {
      ...input,
      location: "A venue, somewhere",
      geoCoordinates: { latitude: 120, longitude: 20 },
    },
    evidence,
  );
  assert.equal(r.geoCoordinates, null);
  assert.equal(r.location.formattedAddress, "A venue, somewhere");
  assert.ok(r.warnings.includes("invalid_or_incomplete_coordinates"));
});

test("API venue coordinates and postal code survive the shared output contract; zero duration is flagged", async () => {
  const data = JSON.parse(
    await readFile(new URL("fixtures/tribe-page.json", import.meta.url)),
  );
  data.events[0].venue.geo_lat = "36.1";
  data.events[0].venue.geo_lng = "-115.2";
  data.events[0].venue.zip = "89101";
  const c = configs.find((c) => c.id === "url-019");
  const r = parseApi(
    JSON.stringify(data),
    "https://network.vegas/wp-json/tribe/events/v1/events?page=1",
    c,
    {},
  ).records[0];
  assert.deepEqual(r.geoCoordinates, { latitude: 36.1, longitude: -115.2 });
  assert.equal(r.location.postalCode, "89101");
  const zero = eventRecord(
    config,
    { ...input, endDate: input.startDate, location: "Venue" },
    evidence,
  );
  assert.equal(zero.fieldQuality.needsReview, true);
});

test("JSON-LD graph venue/address/geo references resolve and virtual locations are not street addresses", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@graph": [
      {
        "@type": "Event",
        name: input.title,
        url: input.url,
        startDate: input.startDate,
        location: [
          { "@type": "VirtualLocation", url: "https://video.example" },
          { "@id": "#venue" },
        ],
      },
      {
        "@id": "#venue",
        "@type": "Place",
        name: "Town Hall",
        address: { "@id": "#address" },
        geo: { "@id": "#geo" },
      },
      {
        "@id": "#address",
        "@type": "PostalAddress",
        streetAddress: "1 Main Street",
        addressLocality: "Portland",
        addressRegion: "ME",
        addressCountry: { name: "US" },
        postalCode: "04101",
      },
      {
        "@id": "#geo",
        "@type": "GeoCoordinates",
        latitude: 43.65,
        longitude: -70.25,
      },
    ],
  })}</script>`;
  const ld = jsonLdEvents(html),
    r = recordFromJsonLd(config, ld.events[0].event, evidence, ld.references);
  assert.equal(r.location.venue, "Town Hall");
  assert.equal(r.location.locality, "Portland");
  assert.deepEqual(r.geoCoordinates, { latitude: 43.65, longitude: -70.25 });
  const virtual = recordFromJsonLd(
    config,
    {
      ...input,
      name: input.title,
      location: { "@type": "VirtualLocation", url: "https://video.example" },
    },
    evidence,
  );
  assert.equal(virtual.location, null);
});

test("invalid clocks and reversed real instants are rejected; overnight and DST offsets survive", async () => {
  for (const startDate of [
    "2026-10-17T25:00:00Z",
    "2026-10-17T12:60:00Z",
    "2026-10-17T12:30:90Z",
    "2026-10-17T12:30:00+99:00",
  ])
    assert.equal(eventRecord(config, { ...input, startDate }, evidence), null);
  assert.equal(
    eventRecord(
      config,
      { ...input, endDate: "2026-10-17T17:00:00-05:00" },
      evidence,
    ),
    null,
  );
  const dst = eventRecord(
    config,
    {
      ...input,
      startDate: "2026-11-01T01:45:00-04:00",
      endDate: "2026-11-01T01:15:00-05:00",
    },
    evidence,
  );
  assert.ok(dst);
  const html = await fixture("eventbrite-overnight-detail");
  const ld = jsonLdEvents(html),
    r = recordFromJsonLd(config, ld.events[0].event, evidence);
  assert.equal(r.startDate, "2026-10-29");
  assert.equal(r.endDate, "2026-10-30");
  assert.equal(r.endLocal, "2026-10-30T04:00:00-04:00");
});

test("NYC Tourism detail extracts the event address and map coordinates rather than market hints", async () => {
  const c = configs.find((c) => c.id === "url-025"),
    url = "https://www.nyctourism.com/events/lincoln-center-2026-2027-season/";
  const r = parseDocument({
    html: await fixture("nyc-tourism-detail"),
    url,
    config: c,
    task: { kind: "detail" },
  }).records[0];
  assert.equal(r.startDate, "2026-09-10");
  assert.equal(r.endDate, "2027-06-19");
  assert.equal(r.location.venue, "Lincoln Center for the Performing Arts");
  assert.equal(r.location.streetAddress, "70 Lincoln Center Plaza");
  assert.equal(r.location.locality, "Manhattan");
  assert.equal(r.location.region, "NY");
  assert.equal(r.location.postalCode, "10023");
  assert.equal(r.location.country, null);
  assert.equal(r.startLocal, null);
  assert.deepEqual(r.geoCoordinates, {
    latitude: 40.7741882,
    longitude: -73.9842563,
  });
});

test("OpenCities detail uses the full date range and event marker, without copying the site footer", async () => {
  const c = configs.find((c) => c.id === "url-080"),
    url = "https://www.downtownorlando.com/Fun/Events/By-Heart-and-By-Hand";
  const r = parseDocument({
    html: await fixture("downtown-orlando-detail"),
    url,
    config: c,
    task: { kind: "detail" },
  }).records[0];
  assert.equal(r.startLocal, "2026-09-05T10:00:00");
  assert.equal(r.endLocal, "2027-03-28T17:00:00");
  assert.equal(r.location.venue, "Orange County Regional History Center");
  assert.equal(r.location.streetAddress, "65 E Central Blvd");
  assert.equal(r.location.locality, null);
  assert.equal(r.location.country, null);
  assert.deepEqual(r.geoCoordinates, {
    latitude: 28.5493147,
    longitude: -81.38659,
  });
});

test("Boston visible occurrence overrides a conflicting JSON-LD timestamp and retains the conflict", async () => {
  const c = configs.find((c) => c.id === "url-054"),
    url = "https://www.boston.gov/calendar/open-streets-roslindale";
  const parsed = parseDocument({
    html: await fixture("boston-detail"),
    url,
    config: c,
    task: { kind: "detail" },
  });
  assert.equal(parsed.records.length, 1);
  const r = parsed.records[0];
  assert.equal(r.startLocal, "2026-10-18T10:30:00");
  assert.equal(r.endLocal, "2026-10-18T15:00:00");
  assert.equal(r.location.locality, "Roslindale");
  assert.equal(r.location.postalCode, "02131");
  assert.ok(
    r.warnings.includes("structured_dates_conflict_with_visible_occurrence"),
  );
  assert.equal(r.fieldQuality.needsReview, true);
  assert.equal(r.raw.structuredCandidates[0].startDate, "2026-10-17");
});

test("article publication metadata cannot masquerade as an event date and placeholder URLs are rejected", () => {
  const c = {
    ...config,
    adapter: "cards",
    cardSelectors: ["article"],
    detailPattern: "/events/",
    maxDepth: 0,
  };
  const html =
    '<article><script type="application/ld+json">{"@type":"Article","datePublished":"2026-10-17"}</script><h2><a href="/events/guide">Annual guide</a></h2><time itemprop="datePublished" datetime="2026-10-17">October 17, 2026</time></article>';
  assert.equal(
    parseDocument({ html, url: c.url, config: c }).records.length,
    0,
  );
  assert.equal(safeUrl("/events/undefined", c.url), null);
  assert.equal(safeUrl("/events/null", c.url), null);
});

test("generic start-only attributes do not assert an end date or time", () => {
  const c = {
    ...config,
    adapter: "cards",
    cardSelectors: [".event-card"],
    detailPattern: "/event/",
    maxDepth: 0,
  };
  for (const start of ["2026-10-17T18:00:00-05:00", "2026-10-17"]) {
    const html = `<article class="event-card"><h3><a href="/event/example">Evening social</a></h3><time datetime="${start}">Starts</time></article>`;
    const r = parseDocument({ html, url: c.url, config: c }).records[0];
    assert.equal(r.startDate, "2026-10-17");
    assert.equal(r.endDate, null);
    assert.equal(r.endLocal, null);
    assert.equal(r.startLocal, start.includes("T") ? start : null);
    assert.equal(r.dateTimeBasis.end, null);
    assert.ok(r.fieldQuality.missing.includes("end_date"));
  }
});

test("generic explicit end attributes retain their independent timestamp and offset", () => {
  const c = {
    ...config,
    adapter: "cards",
    cardSelectors: [".event-card"],
    detailPattern: "/event/",
    maxDepth: 0,
  };
  const html =
    '<article class="event-card"><h3><a href="/event/example">Evening social</a></h3><time itemprop="startDate" datetime="2026-10-17T18:00:00-05:00">Starts</time><time itemprop="endDate" datetime="2026-10-17T21:00:00-05:00">Ends</time></article>';
  const r = parseDocument({ html, url: c.url, config: c }).records[0];
  assert.equal(r.startLocal, "2026-10-17T18:00:00-05:00");
  assert.equal(r.endLocal, "2026-10-17T21:00:00-05:00");
  assert.equal(r.endDate, "2026-10-17");
  assert.equal(r.dateTimeBasis.end, "end attribute");
});

test("a visible multi-day range supplies an end independently of a start attribute", () => {
  const c = {
    ...config,
    adapter: "cards",
    cardSelectors: [".event-card"],
    detailPattern: "/event/",
    maxDepth: 0,
  };
  const html =
    '<article class="event-card"><h3><a href="/event/example">Community festival</a></h3><time datetime="2026-10-17T18:00:00-05:00">Starts</time><span class="date">Oct 17-19, 2026</span></article>';
  const r = parseDocument({ html, url: c.url, config: c }).records[0];
  assert.equal(r.startLocal, "2026-10-17T18:00:00-05:00");
  assert.equal(r.endDate, "2026-10-19");
  assert.equal(r.endLocal, null);
  assert.equal(r.dateTimeBasis.end, "visible listing date/time range");
});

test("a department discovery page cannot publish its misleading Event metadata", async () => {
  const c = configs.find((c) => c.id === "url-055");
  const html =
    '<h1>Tourism, Sports, and Entertainment</h1><script type="application/ld+json">' +
    JSON.stringify({
      "@type": "Event",
      name: "Tourism, Sports, and Entertainment",
      url: c.url,
      startDate: "2026-08-07T15:00:00",
    }) +
    '</script><main><a href="/calendar/open-streets-roslindale">Open Streets</a></main>';
  const listing = parseDocument({ html, url: c.url, config: c });
  assert.equal(listing.records.length, 0);
  assert.ok(
    listing.nextRequests.some((p) =>
      p.url.endsWith("/calendar/open-streets-roslindale"),
    ),
  );
  const detail = parseDocument({
    html: await fixture("boston-detail"),
    url: "https://www.boston.gov/calendar/open-streets-roslindale",
    config: c,
    task: { kind: "detail" },
  });
  assert.equal(detail.records.length, 1);
  assert.equal(detail.records[0].startDate, "2026-10-18");
});

test("a detail heading that only adds the edition year still binds, but only on the same date", () => {
  const make = (title, startDate) =>
    eventRecord(
      config,
      { ...input, title, startDate, endDate: startDate },
      evidence,
    );
  const listing = make("EASTEC", "2027-05-11");
  assert.ok(mergeDetail(listing, make("EASTEC 2027", "2027-05-11")));
  assert.equal(mergeDetail(listing, make("EASTEC 2027", "2027-05-12")), null);
  assert.equal(
    mergeDetail(listing, make("EASTEC Asia 2027", "2027-05-11")),
    null,
  );
  // A trailing "(formerly ...)" note on one side is not part of the name.
  assert.ok(
    mergeDetail(
      make(
        "ADLM Annual Meeting (formerly AACC Annual Scientific Meeting)",
        "2027-07-25",
      ),
      make("ADLM Annual Meeting 2027", "2027-07-25"),
    ),
  );
  assert.equal(
    mergeDetail(
      make("ADLM Annual Meeting (formerly AACC)", "2027-07-25"),
      make("AACC Annual Meeting 2027", "2027-07-25"),
    ),
    null,
  );
  // A listing that already names a year is not loosened.
  assert.equal(
    mergeDetail(
      make("EASTEC 2026", "2027-05-11"),
      make("EASTEC 2027", "2027-05-11"),
    ),
    null,
  );
});

test("reviewed title aliases retain the date guard rather than enabling generic fuzzy matching", () => {
  const listing = eventRecord(
    config,
    {
      ...input,
      title: "NY Auto Show",
      startDate: "2027-03-26",
      endDate: "2027-04-04",
    },
    evidence,
  );
  const detail = eventRecord(
    config,
    {
      ...input,
      title: "New York International Auto Show",
      startDate: "2027-03-26",
      endDate: "2027-04-04",
      location: "Javits Center",
    },
    evidence,
  );
  assert.equal(mergeDetail(listing, detail), null);
  const options = {
    titleAliases: { "NY Auto Show": "New York International Auto Show" },
  };
  assert.ok(mergeDetail(listing, detail, options));
  assert.doesNotThrow(() =>
    mergeDetail(
      { ...listing, title: "toString" },
      { ...detail, title: "toString" },
    ),
  );
  assert.equal(
    mergeDetail(listing, { ...detail, startDate: "2028-03-26" }, options),
    null,
  );
});

test("ConventionGrid list view takes each card's year from its month heading and verifies the stated total", async () => {
  const c = configs.find((c) => c.id === "url-013");
  const html = await fixture("conventiongrid-calendar");
  const parsed = parseDocument({ html, url: c.url, config: c });
  assert.equal(parsed.records.length, 4);
  assert.equal(parsed.rejected, 0);
  assert.equal(parsed.coverage, "verified-list");
  assert.equal(parsed.terminal, true);
  // Featured-show mega-menu links and series pages are not follow-up work.
  assert.deepEqual(parsed.nextRequests.map((r) => r.kind).sort(), [
    "detail",
    "detail",
    "detail",
    "detail",
  ]);
  const byTitle = Object.fromEntries(parsed.records.map((r) => [r.title, r]));
  assert.equal(byTitle["World Travel Market London"].startDate, "2026-11-03");
  assert.equal(byTitle["World Travel Market London"].endDate, "2026-11-05");
  assert.equal(
    byTitle["World Travel Market London"].location.country,
    "United Kingdom",
  );
  assert.deepEqual(
    byTitle["World Travel Market London"].categoryTags.map((t) => t.label),
    ["Travel", "Tourism"],
  );
  assert.equal(byTitle["Example Year-End Expo"].startDate, "2026-12-30");
  assert.equal(byTitle["Example Year-End Expo"].endDate, "2027-01-02");
  assert.equal(byTitle["Example December Show"].endDate, "2026-12-08");
  // A changed stated total, or a card outside its month heading, is not a
  // verified complete list.
  const changed = parseDocument({
    html: html.replace("4 upcoming", "5 upcoming"),
    url: c.url,
    config: c,
  });
  assert.equal(changed.coverage, c.coverage);
  assert.ok(
    changed.issues.some((i) => i.code === "single_page_contract_unverified"),
  );
  const misfiled = parseDocument({
    html: html.replace(
      "Dec 8<!-- --> - <!-- -->Dec 8",
      "Nov 8<!-- --> - <!-- -->Nov 8",
    ),
    url: c.url,
    config: c,
  });
  assert.notEqual(misfiled.coverage, "verified-list");
});

test("inspected location elements retain explicit address components without inventing a city from the market", async () => {
  const chicago = configs.find((c) => c.id === "url-042");
  const r = parseDocument({
    html: await fixture("chicago-parks"),
    url: chicago.url,
    config: { ...chicago, maxDepth: 0 },
  }).records[0];
  assert.equal(r.location.locality, "Chicago");
  assert.equal(r.location.region, "IL");
  assert.equal(r.location.postalCode, "60617");
  assert.equal(r.location.streetAddress, "87th at S. Lake Shore Dr.");
  assert.equal(r.location.country, null);
  const sf = configs.find((c) => c.id === "url-065");
  const s = parseDocument({
    html: await fixture("sf-portal"),
    url: sf.url,
    config: { ...sf, maxDepth: 0 },
  }).records[0];
  assert.equal(s.location.venue, "Moscone Center");
  assert.equal(s.location.locality, null);
  assert.equal(s.marketCity, "San Francisco");
});

test("detail parsing excludes recommended events and preserves distinct occurrences", async () => {
  const html = await fixture("allevents-detail"),
    e = jsonLdEvents(html).events[0].event,
    url = e.url;
  const extra = `<script type="application/ld+json">${JSON.stringify({ ...e, url: url + "/recommended", name: "Another event" })}</script>`;
  const r = parseDocument({
    html: html + extra,
    url,
    config,
    task: { kind: "detail" },
  });
  assert.equal(r.records.length, 1);
  const listing = eventRecord(
    config,
    {
      ...e,
      id: "listing-occurrence",
      startDate: "2026-10-18",
      endDate: "2026-10-18",
    },
    evidence,
  );
  assert.equal(mergeDetail(listing, r.records[0]), null);
});

test("same-day recurring sessions remain separate detail candidates", () => {
  const url = "https://allevents.in/event/sessions";
  const event = (hour) => ({
    "@type": "Event",
    name: "Community sessions",
    url,
    startDate: `2026-10-17T${hour}:00:00-04:00`,
    endDate: `2026-10-17T${Number(hour) + 1}:00:00-04:00`,
    location: "Town Hall",
  });
  const html =
    '<h1>Community sessions</h1><script type="application/ld+json">' +
    JSON.stringify([event("10"), event("14")]) +
    "</script>";
  const parsed = parseDocument({ html, url, config, task: { kind: "detail" } });
  assert.equal(parsed.records.length, 2);
  const listing = eventRecord(
    config,
    {
      title: "Community sessions",
      url,
      startDate: "2026-10-17T14:00:00-04:00",
      endDate: "2026-10-17T15:00:00-04:00",
    },
    evidence,
  );
  assert.equal(parsed.records.filter((r) => mergeDetail(listing, r)).length, 1);
});

test("matching instants survive offset/day differences while DST fold occurrences stay distinct", () => {
  const listing = eventRecord(
    config,
    {
      ...input,
      startDate: "2026-10-18T02:00:00Z",
      endDate: "2026-10-18T04:00:00Z",
    },
    evidence,
  );
  const local = eventRecord(
    config,
    {
      ...input,
      startDate: "2026-10-17T22:00:00-04:00",
      endDate: "2026-10-18T00:00:00-04:00",
    },
    evidence,
  );
  assert.ok(mergeDetail(listing, local));
  const first = eventRecord(
    config,
    {
      ...input,
      startDate: "2026-11-01T01:30:00-04:00",
      endDate: "2026-11-01T01:45:00-04:00",
    },
    evidence,
  );
  const second = eventRecord(
    config,
    {
      ...input,
      startDate: "2026-11-01T01:30:00-05:00",
      endDate: "2026-11-01T01:45:00-05:00",
    },
    evidence,
  );
  assert.equal(mergeDetail(first, second), null);
});

test("known-conflicting UTC markup fails its adapter contract when the visible clock disappears", async () => {
  const original = jsonLdEvents(await fixture("allevents-new-domain-detail"))
    .events[0].event;
  const html =
    "<h1>" +
    original.name +
    '</h1><script type="application/ld+json">' +
    JSON.stringify(original) +
    "</script>";
  assert.throws(
    () =>
      parseDocument({
        html,
        url: original.url,
        config,
        task: { kind: "detail" },
      }),
    { code: "contract_changed" },
  );
});

test("detail enrichment is checkpointed separately, survives re-open and preserves original observations", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "events-field-quality-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "journal.sqlite"),
    j = new Journal(path);
  let open = true;
  t.after(() => {
    if (open) j.close();
  });
  const detail = await fixture("allevents-detail"),
    e = jsonLdEvents(detail).events[0].event;
  const listing =
    '<script type="application/ld+json">' +
    JSON.stringify({
      ...e,
      startDate: "2026-10-17",
      endDate: "2026-10-17",
      location: null,
    }) +
    "</script>";
  const c = {
    ...config,
    enrichDetails: true,
    maxDepth: 1,
    readySelector: null,
  };
  j.register([c]);
  const q = j.enqueue(
    c.id,
    optionsFor(c, { asOf: "2026-10-17", maxPages: 2 }, "fields-test"),
  );
  const seen = [];
  await work(j, {
    root: dir,
    runId: q.runId,
    build: "fields-test",
    transportFactory: () => ({
      fetch: async (task) => {
        seen.push(task.kind);
        return {
          body: task.kind === "detail" ? detail : listing,
          url: task.url,
          capture: { path: join(dir, task.kind + ".html"), hash: task.kind },
        };
      },
      close: async () => {},
    }),
  });
  assert.deepEqual(seen, ["listing", "detail"]);
  assert.equal(j.records(q.runId).length, 1);
  const enriched = j.records(q.runId)[0];
  assert.equal(enriched.endLocal, "2026-10-17T18:00:00-05:00");
  assert.ok(enriched.geoCoordinates);
  assert.equal(enriched.evidence.details.length, 1);
  const original = JSON.parse(
    j.db.prepare("SELECT payload FROM observations WHERE run_id=?").get(q.runId)
      .payload,
  );
  assert.equal(original.startLocal, null);
  assert.equal(original.geoCoordinates, null);
  assert.equal(
    j.db.prepare("SELECT count(*) n FROM record_enrichments").get().n,
    1,
  );
  assert.ok(j.run(q.runId).result.fieldQuality.endTime);
  j.close();
  open = false;
  const reopened = new Journal(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.records(q.runId), [enriched]);
});

test("enrichment and its next-page frontier roll back together on an invalid checkpoint", () => {
  const j = new Journal(":memory:");
  try {
    j.register([config]);
    const q = j.enqueue(
      config.id,
      optionsFor(config, { asOf: "2026-10-17" }, "test"),
    );
    const r = j.claim("owner", 60000, q.runId),
      listing = j.nextPage(r.id, r.token),
      record = eventRecord(config, { ...input, id: "one" }, evidence);
    j.commitPage(
      r.id,
      r.token,
      listing,
      {
        records: [record],
        nextRequests: [
          {
            url: input.url,
            kind: "detail",
            meta: { enrichRecordIds: ["one"] },
          },
        ],
      },
      { path: "listing", hash: "listing" },
    );
    const detail = j.nextPage(r.id, r.token);
    assert.throws(() =>
      j.commitPage(
        r.id,
        r.token,
        detail,
        {
          records: [],
          enrichments: [record],
          nextRequests: [{ url: "file:///invalid" }],
        },
        { path: "detail", hash: "detail" },
      ),
    );
    assert.equal(
      j.db.prepare("SELECT count(*) n FROM record_enrichments").get().n,
      0,
    );
    assert.equal(
      j.pages(r.id).find((p) => p.id === detail.id).state,
      "processing",
    );
  } finally {
    j.close();
  }
});

for (const [name, occurrences, mismatch] of [
  ["a verified listing can complete with detail enrichment", 1, false],
  [
    "recurring occurrences across listing pages share one detail fetch without lost bindings",
    3,
    false,
  ],
  [
    "an unmatched detail still prevents a verified listing from completing",
    1,
    true,
  ],
])
  test(name, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "events-enumeration-detail-")),
      j = new Journal(":memory:");
    t.after(async () => {
      j.close();
      await rm(dir, { recursive: true, force: true });
    });
    const original = jsonLdEvents(await fixture("allevents-detail")).events[0]
      .event;
    const c = {
      ...config,
      adapter: "tribe",
      coverage: "verified-list",
      enrichDetails: true,
      maxDepth: 1,
    };
    j.register([c]);
    const q = j.enqueue(
      c.id,
      optionsFor(
        c,
        { asOf: "2026-10-17", maxPages: occurrences + 1 },
        "enumeration-test",
      ),
    );
    const script = (events) =>
      '<script type="application/ld+json">' +
      JSON.stringify(events) +
      "</script>";
    const seen = [];
    await work(j, {
      root: dir,
      runId: q.runId,
      build: "enumeration-test",
      transportFactory: () => ({
        fetch: async (task) => {
          seen.push(task.kind);
          let body;
          if (task.kind === "listing") {
            const index = Number(
                new URL(task.url).searchParams.get("page") ?? 1,
              ),
              date = `2026-10-${16 + index}`;
            body =
              '<div class="tribe-events-view"></div>' +
              script({
                ...original,
                startDate: date,
                endDate: date,
                location: null,
              }) +
              (index < occurrences
                ? `<a rel="next" href="?page=${index + 1}">Next</a>`
                : "");
          } else
            body =
              "<h1>" +
              original.name +
              "</h1>" +
              script(
                Array.from({ length: occurrences }, (_, i) => {
                  const date = `2026-10-${17 + i}`;
                  return {
                    ...original,
                    name: mismatch ? "Different event" : original.name,
                    startDate: original.startDate.replace("2026-10-17", date),
                    endDate: original.endDate.replace("2026-10-17", date),
                  };
                }),
              );
          return {
            body,
            url: task.url,
            capture: {
              path: join(dir, `${seen.length}.html`),
              hash: String(seen.length),
            },
          };
        },
        close: async () => {},
      }),
    });
    assert.equal(j.run(q.runId).status, mismatch ? "partial" : "complete");
    assert.equal(j.records(q.runId).length, occurrences);
    const details = j.pages(q.runId).filter((p) => p.kind === "detail");
    assert.equal(details.length, 1);
    assert.equal(details[0].meta.enrichRecordIds.length, occurrences);
    assert.deepEqual(seen, [...Array(occurrences).fill("listing"), "detail"]);
    assert.equal(
      j.db.prepare("SELECT count(*) n FROM record_enrichments").get().n,
      mismatch ? 0 : occurrences,
    );
    if (!mismatch)
      assert.ok(
        j
          .records(q.runId)
          .every((r) => r.endLocal && r.location && r.geoCoordinates),
      );
    else
      assert.ok(
        j
          .run(q.runId)
          .result.issues.some(
            (i) => i.code === "detail_occurrence_not_matched",
          ),
      );
  });

test("late occurrence bindings fail visibly and roll back rather than modifying completed detail work", () => {
  const j = new Journal(":memory:");
  try {
    j.register([config]);
    const q = j.enqueue(
      config.id,
      optionsFor(config, { asOf: "2026-10-17" }, "test"),
    );
    const run = j.claim("owner", 60000, q.runId),
      listing = j.nextPage(run.id, run.token),
      record = eventRecord(config, { ...input, id: "one" }, evidence);
    const url = input.url;
    j.commitPage(
      run.id,
      run.token,
      listing,
      {
        records: [record],
        nextRequests: [
          { url, kind: "detail", meta: { enrichRecordIds: ["one"] } },
        ],
      },
      { path: "listing", hash: "listing" },
    );
    const detail = j.nextPage(run.id, run.token);
    j.commitPage(
      run.id,
      run.token,
      detail,
      { records: [], enrichments: [record], nextRequests: [] },
      { path: "detail", hash: "detail" },
    );
    j._addPage(run.id, { url: config.url + "?page=2", kind: "listing" });
    const later = j.nextPage(run.id, run.token);
    assert.throws(
      () =>
        j.commitPage(
          run.id,
          run.token,
          later,
          {
            records: [{ ...record, sourceRecordId: "two" }],
            nextRequests: [
              { url, kind: "detail", meta: { enrichRecordIds: ["two"] } },
            ],
          },
          { path: "later", hash: "later" },
        ),
      { code: "late_detail_bindings" },
    );
    assert.equal(j.records(run.id).length, 1);
    assert.deepEqual(
      j.pages(run.id).find((p) => p.id === detail.id).meta.enrichRecordIds,
      ["one"],
    );
  } finally {
    j.close();
  }
});
