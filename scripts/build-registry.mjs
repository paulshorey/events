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
