import { readFile, writeFile, mkdir } from "node:fs/promises";
const assessed = JSON.parse(
  await readFile("_working/source_assessment.json"),
).rows;
const overrides = {
  "laconventioncenter.com": {
    adapter: "la",
    coverage: "verified-list",
    readySelector: ".eventItem",
    detailPattern: "/events/detail/",
    timeZone: "America/Los_Angeles",
  },
  "boston.gov": {
    adapter: "boston",
    coverage: "verified-list",
    readySelector: "article.calendar-listing-wrapper",
    detailPattern: "/calendar/|/node/",
    timeZone: "America/New_York",
  },
  "network.vegas": {
    adapter: "tribe",
    readySelector: ".tribe-events-calendar-list__event",
    apiEndpoint: "https://network.vegas/wp-json/tribe/events/v1/events",
    timeZone: "America/Los_Angeles",
    detailPattern: "/calendar/[^/?]+/",
  },
  "networkinvegas.com": {
    adapter: "tribe",
    apiEndpoint: "https://networkinvegas.com/wp-json/tribe/events/v1/events",
    timeZone: "America/Los_Angeles",
    detailPattern: "/event/",
  },
  "choosechicago.com": {
    adapter: "tribe",
    apiEndpoint: "https://www.choosechicago.com/wp-json/tribe/events/v1/events",
    timeZone: "America/Chicago",
    detailPattern: "/event/",
  },
  "festivalindex.com": {
    adapter: "festivalindex",
    readySelector: "[data-event-payload]",
    detailPattern: "/en-us/events/",
  },
  "washington.org": {
    adapter: "dc-tourism",
    readySelector: ".event-wrapper",
    detailPattern: "/event/",
    timeZone: "America/New_York",
  },
  "javitscenter.com": {
    adapter: "javits",
    readySelector: "h3.uppercase",
    detailPattern: "/events?/|/calendar",
    timeZone: "America/New_York",
  },
  "allevents.in": {
    adapter: "jsonld",
    readySelector: ".event-card",
    detailPattern: "/[^/]+/[^/]+/\\d+|/e\\d+",
  },
  "eventbrite.com": {
    adapter: "jsonld",
    readySelector: ".event-card",
    detailPattern: "/e/",
  },
  "dothisnyc.com": {
    adapter: "jsonld",
    detailPattern: "street-fairs-nyc|#e=",
    timeZone: "America/New_York",
  },
  "nycgovparks.org": {
    adapter: "microdata",
    detailPattern: "/events/\\d{4}/|/events/festivals",
    timeZone: "America/New_York",
  },
  "conventiongrid.com": {
    adapter: "conventiongrid",
    detailPattern: "/shows/|/calendar/\\d{4}/",
  },
  "thetradeshowcalendar.com": {
    adapter: "trade-table",
    detailPattern: "/ttn/index.php",
  },
  "nyctourism.com": {
    adapter: "nyc-tourism",
    readySelector: "[class*=ContentCard_headerLink]",
    detailPattern: "/events/[^/?]+",
    timeZone: "America/New_York",
  },
  "portal.sftravel.com": {
    adapter: "sf-portal",
    readySelector: "tr.resultlist",
    detailPattern: "/calendar_public/",
    timeZone: "America/Los_Angeles",
  },
  "miamiandbeaches.com": {
    adapter: "cards",
    cardSelectors: ["article.ys-card"],
    detailPattern: "/event/",
    timeZone: "America/New_York",
  },
  "orlando.gov": {
    adapter: "opencities",
    cardSelectors: [
      ".list-item-container",
      ".list-item",
      ".event-item",
      "article",
    ],
    detailPattern: "/Events/[^/?]+",
    timeZone: "America/New_York",
  },
  "downtownorlando.com": {
    adapter: "opencities",
    cardSelectors: [".list-item-container", ".list-item", "article"],
    detailPattern: "/Fun/Events/[^/?]+",
    timeZone: "America/New_York",
  },
  "visitdallas.com": {
    adapter: "cards",
    cardSelectors: ["article.card--listing"],
    detailPattern: "/events/[^/?]+",
    timeZone: "America/Chicago",
  },
  "chicagoparkdistrict.com": {
    adapter: "chicago-parks",
    cardSelectors: [".views-row"],
    detailPattern: "/events/[^/?]+",
    timeZone: "America/Chicago",
  },
  "discoverlosangeles.com": {
    adapter: "cards",
    cardSelectors: ["article.node--type-event", ".views-row"],
    detailPattern: "/event/|/events/[^/?]+",
    timeZone: "America/Los_Angeles",
  },
  "eventsdc.com": {
    adapter: "cards",
    cardSelectors: [".views-row"],
    detailPattern: "/events/[^/?]+",
    timeZone: "America/New_York",
  },
  "visitseattle.org": {
    adapter: "cards",
    cardSelectors: [
      ".search-result",
      ".event-result",
      ".event-item",
      ".search-result-preview",
    ],
    detailPattern: "/events/[^/?]+",
    timeZone: "America/Los_Angeles",
  },
  "visitsandiego.com": {
    adapter: "san-diego",
    cardSelectors: [".event", ".event-item", ".event-card"],
    detailPattern: "/event/|/calendar/[^/?]+",
    timeZone: "America/Los_Angeles",
    coverage: "verified-list",
    listCompleteness: "client-reveal",
    revealProbe: {
      control: ".calendar .loadMore",
      item: ".calendar .item",
      maxClicks: 20,
      settleMs: 800,
      quietMs: 2500,
      // Observed November 4, 2026: the UserWay accessibility widget's
      // requests during clicks; unrelated to calendar rows.
      ignoreHosts: ["api.userway.org", "cdn.userway.org"],
    },
  },
};
const sourceOverrides = {
  "url-037": {
    entrypoints: ["https://www.laconventioncenter.com/events/all"],
    aliasOf: "url-038",
  },
  "url-054": { adapter: "boston", coverage: "verified-list" },
  "url-055": {
    adapter: "discovery",
    coverage: "discovery",
    readySelector: null,
  },
  "url-019": { coverage: "verified-list" },
  "url-020": { coverage: "verified-list", apiEndpoint: null },
  "url-084": { coverage: "historical-view" },
  // Chicago Parks: single-day cards print no year, so detail pages are the
  // observations; multi-day cards are enriched from theirs. Inspected Nov 5, 2026.
  "url-042": {
    enrichDetails: true,
    // The listing already queues every event card's detail page; link
    // discovery would also follow site furniture such as /events/map.
    discoverDetails: false,
    notes:
      "Drupal event finder: pages follow the pager's next link; single-day cards print only month/day, so each detail page (which prints the year and clock) is its own observation. Multi-day cards print full dates and are enriched from their detail page. Inspected November 5, 2026.",
  },
  // Houston city calendar: the page embeds a published Outlook calendar; its
  // calendar.ics sibling is the public iCalendar feed (904 VEVENTs, no RRULEs).
  "url-045": {
    adapter: "icalendar",
    apiFormat: "ics",
    entrypoints: [
      {
        url: "https://outlook.office365.com/owa/calendar/378a27e8d0ee477ebd4c9db5ce3a600f@houstontx.gov/9d0692828d624e8bb74ce935644940f417387657915531835411/calendar.ics",
        kind: "api",
        depth: 0,
      },
    ],
    allowedHosts: ["www.houstontx.gov", "outlook.office365.com"],
    discoverDetails: false,
    notes:
      "The page embeds the city's published Outlook calendar (iframe); its calendar.ics sibling is the public iCalendar feed of the same calendar. Inspected November 5, 2026: 904 VEVENTs, no RRULEs, Central time zone ids. A curated selection of venue and city events, not every Houston event.",
  },
  // houston.com: Event JSON-LD on /events/<slug> pages (UTC instants), found
  // through the listing and the published events sitemap.
  "url-047": {
    adapter: "houston-com",
    apiFormat: "sitemap",
    localizeUtcInstants: true,
    discoveryOnly: true,
    entrypoints: [
      "https://houston.com/events",
      { url: "https://houston.com/events-sitemap.xml", kind: "api", depth: 0 },
    ],
    detailPattern: "^/events/[a-z0-9][a-z0-9-]*-[a-z0-9]{8}$",
    notes:
      "Next.js listing without pagination; each /events/<slug> page carries schema.org Event JSON-LD whose startDate is a UTC instant (converted to America/Chicago and checked against the listing's printed local time). The published events sitemap adds pages the listing does not show. Inspected November 5, 2026.",
  },
  // UChicago: public Live calendar JSON API linked from the feeds page.
  "url-096": {
    adapter: "live-calendar",
    apiFormat: "live-json",
    entrypoints: [
      {
        url: "https://events.uchicago.edu/live/json/events/response_fields/location,event_types,event_types_audience,event_types_campus,tags",
        kind: "api",
        depth: 0,
      },
    ],
    discoverDetails: false,
    notes:
      "Public JSON API linked from the calendar's feed page (/live/json/events). Default window is the next ~3 months of occurrences, 100 per page, links.next pagination, explicit local ISO timestamps and IANA time zone. Includes internal campus events; audience is kept as raw metadata. Inspected November 5, 2026.",
  },
};
const timeZones = {
  "Las Vegas": "America/Los_Angeles",
  "New York City": "America/New_York",
  "Los Angeles": "America/Los_Angeles",
  Chicago: "America/Chicago",
  Houston: "America/Chicago",
  "Washington, DC": "America/New_York",
  Boston: "America/New_York",
  Miami: "America/New_York",
  Seattle: "America/Los_Angeles",
  "San Francisco": "America/Los_Angeles",
  Atlanta: "America/New_York",
  Dallas: "America/Chicago",
  "New Orleans": "America/Chicago",
  Denver: "America/Denver",
  Orlando: "America/New_York",
  "San Diego": "America/Los_Angeles",
};
const configs = assessed.map((row) => {
  const platform = row.familyHint;
  const generic = {
    adapter: platform.includes("simpleview")
      ? "jsonld"
      : platform.includes("trumba")
        ? "embedded-calendar"
        : "discovery",
    coverage: "unverified",
    detailPattern:
      "/events?/[^/?#]+|/calendar/[^/?#]+|/shows/|/festivals?/[^/?#]+",
    cardSelectors: [
      ".event-card",
      ".event-item",
      ".events-item",
      ".event-listing",
      "[data-event-id]",
      ".views-row",
      "article",
    ],
    readySelector: null,
  };
  const c = {
    id: row.id,
    url: row.url,
    sourceKey: row.sourceHost,
    rateKey: row.sourceHost,
    group: row.group,
    origin: row.origin,
    cityMarket: row.cityMarketHint,
    categoryHints: row.categoryHints,
    intervalHours: row.proposedCadenceHours,
    enabled: false,
    adapterVersion: "framework-v1",
    timeZone: timeZones[row.group] ?? "America/New_York",
    ...generic,
    ...overrides[row.sourceHost],
    ...sourceOverrides[row.id],
    notes: row.nextStep,
    role: row.role,
    allowedHosts: [new URL(row.url).hostname],
    maxDepth: 2,
    validationStatus: "needs-validation",
    script: `scrapers/${row.id}.mjs`,
  };
  // Source-specific overrides win over the derived notes and allowed hosts.
  Object.assign(c, sourceOverrides[row.id]);
  if (
    row.role.includes("guide") ||
    row.role.includes("information") ||
    row.role === "homepage" ||
    row.role.includes("press") ||
    row.role.includes("reference")
  )
    c.coverage = "discovery";
  return c;
});
await mkdir("scrapers", { recursive: true });
for (const c of configs)
  await writeFile(
    c.script,
    `// ${c.group}: ${c.url}\n// Strategy and selectors: sources/registry.json (${c.id}). Shared implementation: src/adapters/.\nimport { scraperMain } from '../src/cli.mjs';\nawait scraperMain('${c.id}', process.argv.slice(2));\n`,
  );
await writeFile(
  "sources/registry.json",
  JSON.stringify(configs, null, 2) + "\n",
);
console.log(
  JSON.stringify({ registered: configs.length, entrypoints: configs.length }),
);
