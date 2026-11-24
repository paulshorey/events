import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Transport } from "../src/runtime/transport.mjs";
import { Journal } from "../src/storage/journal.mjs";
const configs = await registry();
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");

test("Eventbrite search results use upstream dates, clock times, venue and a verified page chain", async () => {
  const config = configs.find((c) => c.id === "url-023"),
    html = await fixture("eventbrite-search"),
    url = config.entrypoints[0];
  const parsed = parseDocument({ html, url, config });
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.observedCount, 3);
  assert.equal(parsed.nextRequests.length, 1);
  assert.equal(parsed.nextRequests[0].url, `${url}?page=2`);
  assert.equal(parsed.terminal, false);
  assert.equal(
    parsed.nextRequests.some((r) => r.kind === "detail"),
    false,
  );
  // 49 pages of 20 cannot hold 2410 objects: the capped view is never "complete".
  assert.equal(parsed.coverage, "unverified");
  assert.ok(parsed.issues.some((i) => i.code === "search_view_capped"));
  const anime = parsed.records.find((r) => /Sin City Anime/.test(r.title));
  assert.equal(anime.startLocal, "2026-11-20T12:00");
  assert.equal(anime.endLocal, "2026-11-22T21:00");
  assert.equal(anime.timeZone, "America/Los_Angeles");
  assert.equal(anime.timeZoneBasis, "source time zone");
  assert.equal(anime.location.venue, "The Orleans Hotel & Casino");
  assert.equal(anime.location.locality, "Las Vegas");
  assert.ok(anime.geoCoordinates.latitude > 36);
  assert.ok(anime.categoryTags.length > 0);
  // Page chain: the requested page must match the delivered page, and the last page is terminal.
  assert.throws(
    () => parseDocument({ html, url: `${url}?page=3`, config }),
    (e) => e.code === "pagination_changed",
  );
  const end = parseDocument({
    html: html.replaceAll('"page_number":1', '"page_number":49'),
    url: `${url}?page=49`,
    config,
  });
  assert.equal(end.terminal, true);
  assert.equal(end.nextRequests.length, 0);
  // A missing results contract is a contract change, not an empty success.
  assert.throws(
    () =>
      parseDocument({
        html: html.replace('"results"', '"gone"'),
        url,
        config,
      }),
    (e) => e.code === "contract_changed",
  );
});
test("Vegas.com festival guide records only fully dated entries and never invents dates", async () => {
  const config = configs.find((c) => c.id === "url-017"),
    html = await fixture("vegas-festival-guide");
  const parsed = parseDocument({ html, url: config.url, config });
  const byId = Object.fromEntries(
    parsed.records.map((r) => [r.sourceRecordId, r]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    "edc-las-vegas-edc-dawn",
    "edc-las-vegas-edc-dusk",
    "iheartradio-music-festival",
    "pride-parade-festival-pride-festival",
    "pride-parade-festival-pride-parade",
    "sema-fest",
  ]);
  assert.equal(byId["sema-fest"].startDate, "2026-11-06");
  assert.equal(byId["sema-fest"].location.venue, "Las Vegas Convention Center");
  assert.equal(byId["iheartradio-music-festival"].endDate, "2026-09-19");
  assert.equal(byId["edc-las-vegas-edc-dawn"].startDate, "2026-05-21");
  assert.equal(
    byId["edc-las-vegas-edc-dawn"].title,
    "EDC Las Vegas - EDC DAWN",
  );
  assert.equal(
    byId["pride-parade-festival-pride-parade"].startDate,
    "2026-10-09",
  );
  // "October 2026, exact dates TBD" and "Postponed until October 2027" are observed but undated.
  assert.equal(parsed.observedCount, 8);
  assert.equal(parsed.nextRequests.length, 0);
  assert.equal(parsed.terminal, false);
});
test("NYC inspected controls require the correct active page and an explicit terminal control", async () => {
  const config = configs.find((c) => c.id === "url-024"),
    html = await fixture("nyc-pagination");
  const parsed = parseDocument({ html, url: config.url, config });
  assert.equal(parsed.coverage, "verified-list");
  assert.equal(parsed.terminal, false);
  assert.equal(
    parsed.nextRequests.find((r) => r.kind === "listing").meta.browserPage,
    2,
  );
  assert.throws(
    () =>
      parseDocument({
        html,
        url: config.url,
        config,
        task: { kind: "listing", depth: 0, meta: { browserPage: 2 } },
      }),
    /received 1/,
  );
  const $ = load(html);
  $("li.next").addClass("disabled");
  assert.equal(
    parseDocument({ html: $.html(), url: config.url, config }).terminal,
    true,
  );
  $('ul[class*="SearchPagination_pagination"]').remove();
  assert.throws(
    () => parseDocument({ html: $.html(), url: config.url, config }),
    /pagination/,
  );
});

test("OpenCities follows the observed query parameter and reconciles page count and requested page", async () => {
  const config = configs.find((c) => c.id === "url-080"),
    html = await fixture("orlando-pagination");
  const parsed = parseDocument({ html, url: config.url, config });
  assert.equal(parsed.records.length, 10);
  const url = parsed.nextRequests.find((r) => r.kind === "listing").url;
  assert.equal(
    new URL(url).searchParams.get(config.pagination.parameter),
    "(pageindex=2)",
  );
  assert.throws(() => parseDocument({ html, url, config }), /disagreement/);
  const $ = load(html);
  $(".seamless-pagination-info").text("Page 20 of 20");
  const last = new URL(config.url);
  last.searchParams.set(config.pagination.parameter, "(pageindex=20)");
  assert.equal(
    parseDocument({ html: $.html(), url: last.href, config }).terminal,
    true,
  );
});

test("LA calendar cards preserve native event dates and venue without sponsored/mobile duplicates", async () => {
  const config = configs.find((c) => c.id === "url-035"),
    html = await fixture("discover-la-calendar");
  const parsed = parseDocument({ html, url: config.url, config });
  assert.ok(parsed.records.length >= 5);
  assert.equal(parsed.rejected, 0);
  assert.ok(parsed.records.every((r) => r.startDate && r.location?.venue));
  assert.ok(parsed.records.every((r) => r.endDate === null));
  assert.equal(
    new Set(parsed.records.map((r) => r.sourceRecordId)).size,
    parsed.records.length,
  );
  assert.equal(parsed.coverage, "unverified");
});

test("tracking URLs mentioning events do not masquerade as embedded calendars", () => {
  const config = {
    ...configs.find((c) => c.id === "url-039"),
    listingContract: undefined,
    enrichDetails: false,
  };
  const event =
    '<script type="application/ld+json">{"@type":"Event","name":"Dance","url":"https://www.choosechicago.com/event/dance","startDate":"2026-10-25"}</script>';
  const tracking = parseDocument({
    html:
      event +
      '<iframe src="https://tracker.example/pixel?ref=https://www.choosechicago.com/events/"></iframe>',
    url: config.url,
    config,
  });
  assert.equal(
    tracking.issues.some(
      (i) => i.code === "embedded_calendar_requires_validation",
    ),
    false,
  );
  const embedded = parseDocument({
    html:
      event + '<iframe src="https://calendar.example/calendar/embed"></iframe>',
    url: config.url,
    config,
  });
  assert.ok(
    embedded.issues.some(
      (i) => i.code === "embedded_calendar_requires_validation",
    ),
  );
});

test("real browser waits for event titles after the active page and hrefs change early", async (t) => {
  const html = `<div class="Card_card__fixture"><a class="ContentCard_headerLink" href="/events/first/">First dance</a><div class="ContentCard_tagContainer">Oct 25, 2026</div></div>
    <ul class="SearchPagination_pagination"><li class="SearchPagination_active">1</li><li class="next"><a onclick="document.querySelector('.SearchPagination_active').textContent='2';document.querySelector('.ContentCard_headerLink').href='/events/first';setTimeout(()=>{document.querySelector('.ContentCard_headerLink').textContent='Second dance';document.querySelector('.ContentCard_headerLink').href='/events/second/';document.querySelector('li.next').classList.add('disabled')},150)">Next</a></li></ul>`;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(req.url === "/robots.txt" ? "User-agent: *\nAllow: /" : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = await mkdtemp(join(tmpdir(), "events-browser-pages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const url = `http://127.0.0.1:${server.address().port}/events/`,
    config = {
      ...configs.find((c) => c.id === "url-024"),
      url,
      allowedHosts: ["127.0.0.1"],
      maxDepth: 0,
    };
  const journal = new Journal(":memory:");
  const transport = new Transport({
    root,
    journal,
    run: {
      id: "fixture",
      attemptId: "test",
      config,
      source_key: "fixture",
      options: { diagnostics: true },
    },
  });
  t.after(async () => {
    await transport.close();
    journal.close();
  });
  const first = await transport.fetch({
    id: 1,
    url,
    kind: "listing",
    depth: 0,
    meta: {},
  });
  const a = parseDocument({ html: first.body, url, config });
  const next = a.nextRequests.find((r) => r.kind === "listing");
  const second = await transport.fetch({ id: 2, ...next });
  const b = parseDocument({ html: second.body, url, config, task: next });
  assert.equal(a.records[0].title, "First dance");
  assert.equal(b.records[0].title, "Second dance");
  assert.equal(b.terminal, true);
  assert.equal(transport.listingPage.listenerCount("pageerror"), 0);
});

test("browser Retry-After persists a publisher cooldown and prevents a second network request", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /");
    requests++;
    res.writeHead(429, { "Retry-After": "120", "Content-Type": "text/html" });
    res.end("<h1>Slow down</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = await mkdtemp(join(tmpdir(), "events-browser-cooldown-")),
    journal = new Journal(":memory:");
  const url = `http://127.0.0.1:${server.address().port}/events/`,
    config = {
      ...configs.find((c) => c.id === "url-054"),
      url,
      allowedHosts: ["127.0.0.1"],
    };
  const transport = new Transport({
    root,
    journal,
    run: { id: "cooldown", attemptId: "test", config, source_key: "fixture" },
  });
  t.after(async () => {
    await transport.close();
    journal.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(
    transport.fetch({ id: 1, url, kind: "listing", depth: 0, meta: {} }),
    (e) => e.code === "rate_limited" && e.retryAfterMs === 120000,
  );
  const afterFirst = requests;
  await assert.rejects(
    transport.fetch({ id: 2, url, kind: "listing", depth: 0, meta: {} }),
    (e) => e.code === "rate_limited" && /cooldown/.test(e.message),
  );
  assert.equal(requests, afterFirst);
});
