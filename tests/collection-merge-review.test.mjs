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
