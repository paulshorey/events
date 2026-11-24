import { eventRecord, text, safeUrl } from "../records.mjs";

// Publisher search indexes (Algolia) that back a site's own event calendar.
// The request is a plain GET against the index with the search-only
// application key the site ships to every browser. Nothing is signed in or
// bypassed; the same hits populate the rendered calendar.
const pad = (n) => String(n).padStart(2, "0");

export function zonedDate(epochSeconds, timeZone) {
  if (!Number.isFinite(epochSeconds)) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(epochSeconds * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Epoch seconds of 00:00 on a calendar date in the source time zone.
export function zonedMidnightEpoch(date, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const offsetAt = (ms) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    return (
      Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) -
      ms
    );
  };
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  return Math.floor(utc / 1000);
}

export function algoliaRequestUrl(config, options, page = 0) {
  const a = config.algolia;
  const url = new URL(
    `https://${a.applicationId.toLowerCase()}-dsn.algolia.net/1/indexes/${encodeURIComponent(a.index)}`,
  );
  const filters = a.filters.replaceAll(
    "{asOfEpoch}",
    String(zonedMidnightEpoch(options.asOf, config.timeZone)),
  );
  url.searchParams.set("x-algolia-api-key", a.searchKey);
  url.searchParams.set("x-algolia-application-id", a.applicationId);
  url.searchParams.set("filters", filters);
  url.searchParams.set("hitsPerPage", String(a.hitsPerPage ?? 100));
  url.searchParams.set("page", String(page));
  url.searchParams.set("query", "");
  return url.href;
}

export function parseAlgolia(body, url, config, task) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Search API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  if (
    !Array.isArray(data?.hits) ||
    !Number.isInteger(data.nbHits) ||
    !Number.isInteger(data.nbPages) ||
    !Number.isInteger(data.page)
  )
    throw Object.assign(new Error("Search API contract changed"), {
      code: "contract_changed",
    });
  const site = new URL(config.url).origin,
    records = [],
    issues = [];
  let rejected = 0;
  for (const hit of data.hits) {
    const startDate = zonedDate(hit.startDate, config.timeZone),
      endDate = hit.hasEndDate ? zonedDate(hit.endDate, config.timeZone) : null;
    const neighborhood = text(hit.primaryLocation) || null;
    const record = eventRecord(
      config,
      {
        id: `${hit.objectID}|${startDate}`,
        title: hit.displayTitle ?? hit.shortTitle,
        url: safeUrl(hit.url, site),
        startDate,
        endDate,
        dateTimeBasis: {
          start: "publisher search index startDate (local calendar day)",
          end: endDate ? "publisher search index endDate (local calendar day)" : null,
        },
        location: {
          venue: hit.venueName ? text(hit.venueName) : null,
          neighborhood,
          basis: "publisher search index venue and neighborhood label",
        },
        categoryTags: [hit.primaryCategory, ...(hit["Lookup - Type"] ?? [])]
          .filter(Boolean)
          .map((label) => ({
            label: text(label),
            basis: "publisher search index category",
          })),
        raw: {
          objectID: hit.objectID,
          startDate: hit.startDate,
          endDate: hit.endDate,
          hasEndDate: hit.hasEndDate,
          primaryLocation: hit.primaryLocation,
          venueName: hit.venueName,
          borough: hit["Lookup - Borough"],
          repeatEvent: hit.repeatEvent,
          allOccurrences: hit.allOccurrences,
          website: hit.website,
        },
      },
      { url, selector: "algolia hit", objectID: hit.objectID },
    );
    if (record)
      records.push({ ...record, validationStatus: "parser-validated" });
    else rejected++;
  }
  if (rejected)
    issues.push({ code: "search_hits_rejected", count: rejected });
  const nextRequests = [];
  const terminal = data.page + 1 >= data.nbPages;
  if (!terminal) {
    const next = new URL(url);
    next.searchParams.set("page", String(data.page + 1));
    nextRequests.push({
      url: next.href,
      kind: "api",
      depth: 0,
      meta: { pagination: true },
    });
  }
  return {
    records,
    nextRequests,
    expectedTotal: data.nbHits,
    terminal,
    coverage: "api-query",
    method: "algolia-search-index",
    issues,
    rejected,
    observedCount: data.hits.length,
    scopeWarning:
      "Publisher search-index query for the calendar's default Events & Festivals filter; date-only start/end days",
  };
}
