// Regressions for review findings on the merged November 5 collection adapters.
import test from "node:test";
import assert from "node:assert/strict";
import { Journal } from "../src/storage/journal.mjs";
import { registry } from "../src/registry.mjs";
import { optionsFor } from "../src/worker.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { parseSitemapEntries } from "../src/adapters/regional.mjs";

const configs = await registry();
const byId = (id) => configs.find((c) => c.id === id);

function firstPage(id) {
  const j = new Journal(":memory:");
  j.register(configs);
  const c = byId(id);
  const { runId } = j.enqueue(
    id,
    optionsFor(c, { asOf: "2026-11-05", transport: "api" }, "test-build"),
  );
  const page = j.pages(runId)[0];
  j.close();
  return page;
}

test("formatted API sources are seeded from their API, feed sources from their entrypoints", () => {
  const eventfinder = firstPage("url-004");
  assert.equal(eventfinder.kind, "api");
  assert.equal(
    new URL(eventfinder.url).origin,
    new URL(byId("url-004").apiEndpoint).origin,
  );
  assert.equal(eventfinder.meta.request.method, "POST");
  const algolia = firstPage("url-024");
  assert.equal(algolia.kind, "api");
  assert.match(algolia.url, /algolia\.net/);
  const geodirectory = firstPage("url-006");
  assert.equal(geodirectory.kind, "api");
  assert.ok(!new URL(geodirectory.url).searchParams.has("start_date"));
  const ics = firstPage("url-045");
  assert.equal(ics.kind, "api");
  assert.match(ics.url, /calendar\.ics$/);
});

test("an empty last page with only a back link is not a verified empty list", () => {
  const c = byId("url-002");
  const url = new URL(c.url);
  url.searchParams.set("page", "3");
  const r = parseDocument({
    html: `<html><body><a href="${url.pathname}?page=2">Previous</a></body></html>`,
    url: url.href,
    config: { ...c, maxDepth: 0 },
  });
  assert.equal(r.records.length, 0);
  assert.ok(r.issues.some((i) => i.code === "no_event_contract_found"));
});

test("a sitemap index queues its same-host child sitemaps", () => {
  const r = parseSitemapEntries({
    body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://www.example.test/sitemap-events-1.xml</loc></sitemap>
      <sitemap><loc>https://elsewhere.test/sitemap.xml</loc></sitemap></sitemapindex>`,
    url: "https://www.example.test/sitemap.xml",
    config: { detailPattern: "^/event/" },
  });
  assert.deepEqual(
    r.nextRequests.map((n) => [n.url, n.kind]),
    [["https://www.example.test/sitemap-events-1.xml", "api"]],
  );
  assert.equal(r.observedCount, 0);
  assert.deepEqual(r.issues, []);
});

test("API-entrypoint-only collections default to the api transport", () => {
  for (const id of ["url-045", "url-096", "url-072"])
    assert.equal(
      optionsFor(byId(id), { asOf: "2026-11-05" }, "b").transport,
      "api",
      id,
    );
  // Mixed listing + sitemap entrypoints stay browser.
  assert.equal(
    optionsFor(byId("url-047"), { asOf: "2026-11-05" }, "b").transport,
    "browser",
  );
});

test("a destinations card without exactly one city page fails the hub contract", () => {
  const c = byId("url-015");
  const card = (href) =>
    `<div class="entity-grid-card"><a href="${href}">City</a></div>`;
  const html = (cards) => `<html><body>${cards.join("")}</body></html>`;
  const url = "https://conventioncalendar.com/destinations";
  const ok = parseDocument({
    html: html([card("/us/ny/new-york-city"), card("/us/fl/orlando")]),
    url,
    config: c,
  });
  assert.equal(ok.nextRequests.filter((r) => r.meta?.destination).length, 2);
  assert.throws(
    () =>
      parseDocument({
        html: html([card("/us/ny/new-york-city"), card("/promo")]),
        url,
        config: c,
      }),
    (e) => e.code === "contract_changed",
  );
});

import { readFile } from "node:fs/promises";
import { parseSharePointCalendar } from "../src/adapters/regional.mjs";
const fx = (name) =>
  readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("an unexpanded SharePoint recurrence keeps the run from completing", async () => {
  const r = parseSharePointCalendar({
    body: await fx("sharepoint-city-calendar.json"),
    url: "https://dallascityhall.com/calendar/_api/Web/Lists/GetByTitle('City%20Calendar')/items",
    config: byId("url-072"),
  });
  assert.ok(r.issues.some((i) => i.code === "recurring_series_not_expanded"));
});

test("an uncapped Eventbrite page with fewer results than promised is not verified", async () => {
  const c = byId("url-023");
  const html = (await fx("eventbrite-search.html")).replace(
    '"object_count":2410',
    '"object_count":980',
  );
  const r = parseDocument({
    html,
    url: c.entrypoints[0],
    config: { ...c, maxDepth: 0 },
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.notEqual(r.coverage, "verified-list");
  assert.ok(r.issues.some((i) => i.code === "page_result_count_mismatch"));
  assert.equal(r.expectedTotal, 980);
});

test("City Guide flags an overnight time range instead of dropping its end silently", async () => {
  const c = byId("url-030");
  const html = (await fx("cityguide-cards.html")).replace("7pm", "10pm-2am");
  const r = parseDocument({
    html,
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  assert.ok(
    r.records.some((e) =>
      e.warnings?.includes("overnight_end_time_not_applied"),
    ),
  );
});

test("same-named unlinked street permits on one day keep distinct identities", async () => {
  const c = byId("url-033");
  const html = await fx("dothis-street-fairs-days.html");
  const row = html.match(
    /<tr data-type="fair" data-image="permit-recordando[\s\S]*?<\/tr>/,
  )[0];
  const twin = row.replace(
    "44 Street between 5 Avenue and 6 Avenue",
    "45 Street between 5 Avenue and 6 Avenue",
  );
  const r = parseDocument({
    html: html
      .replace(row, row + twin)
      .replace("13 street fairs", "14 street fairs"),
    url: c.url,
    config: c,
    task: { depth: 0, kind: "listing", meta: {} },
  });
  const ids = r.records
    .filter((e) => e.title.startsWith("Recordando"))
    .map((e) => e.sourceRecordId);
  assert.equal(new Set(ids).size, 2);
});

import { parseEventfinderPage } from "../src/adapters/eventfinder.mjs";
import { identityCollisions } from "../src/records.mjs";

test("Eventfinder takes location fields from one authoritative object and checks page sizes", async () => {
  const c = byId("url-004");
  const body = await fx("eventfinder-search.json");
  const data = JSON.parse(body);
  const task = {
    meta: {
      request: {
        body: { page: data.pagination.page, limit: data.events.length },
      },
    },
  };
  const r = parseEventfinderPage(body, c.apiEndpoint, c, task);
  const statesboro = r.records.find((e) => e.sourceRecordId === "254324");
  assert.equal(statesboro.location.locality ?? null, null);
  assert.match(statesboro.location.formattedAddress, /Savannah/);
  assert.ok(statesboro.warnings.includes("venue_and_event_location_disagree"));
  const chicago = r.records.find((e) => e.sourceRecordId === "241158");
  assert.equal(chicago.location.venue ?? null, null);
  assert.equal(chicago.location.locality, "Chicago");
  // A response shorter than the requested limit is not a complete page.
  const short = parseEventfinderPage(body, c.apiEndpoint, c, {
    meta: {
      request: {
        body: { page: data.pagination.page, limit: data.events.length + 5 },
      },
    },
  });
  if (data.pagination.page < data.pagination.totalPages)
    assert.ok(
      short.issues.some((i) => i.code === "page_result_count_mismatch"),
    );
});

test("a stale destinations page served under a later URL fails the hub contract", () => {
  const c = byId("url-015");
  const html = `<html><body><div class="entity-grid-card"><a href="/us/ny/new-york-city">NYC</a></div>
    <a rel="next" href="/destinations?page=2">Next</a></body></html>`;
  assert.throws(
    () =>
      parseDocument({
        html,
        url: "https://conventioncalendar.com/destinations?page=2",
        config: c,
      }),
    (e) => e.code === "pagination_changed",
  );
  assert.ok(
    parseDocument({
      html,
      url: "https://conventioncalendar.com/destinations",
      config: c,
    }),
  );
});

test("records sharing an identity but different core fields are counted as collisions", () => {
  const a = { sourceRecordId: "x", title: "A", startDate: "2026-11-07" };
  assert.equal(
    identityCollisions([a, { ...a, evidence: { selector: "other" } }]),
    0,
  );
  assert.equal(
    identityCollisions([a, { ...a, location: { venue: "Hall 2" } }]),
    1,
  );
});
