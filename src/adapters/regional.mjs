// Publisher contracts inspected on November 5, 2026 for Seattle, Dallas and Miami.
// Each parser reads captured evidence only; nothing here is guessed from platform names.
import { load } from "cheerio";
import { eventRecord, safeUrl, text, validDate } from "../records.mjs";

const iso = (m, d, y) => {
  const value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return validDate(value) ? value : null;
};

// Visit Seattle prints one of: "11/5/2026", "4/16/2027 through 4/27/2027",
// "Now through 12/31/2027" or "Ongoing". Only an explicit start date is a dated
// observation; an open-ended or "Now through" claim has no start to record.
export function parseSeattleDate(raw) {
  const value = text(raw);
  const all = [...value.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map(
    (m) => iso(m[1], m[2], m[3]),
  );
  if (/^ongoing$/i.test(value)) return { kind: "ongoing", value };
  if (/^now\s+through\b/i.test(value) && all.length === 1)
    return { kind: "now-through", endDate: all[0], value };
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value) && all[0])
    return { kind: "single", startDate: all[0], endDate: all[0], value };
  const range = value.match(
    /^\d{1,2}\/\d{1,2}\/\d{4}\s+through\s+\d{1,2}\/\d{1,2}\/\d{4}$/i,
  );
  if (range && all.length === 2 && all[0] && all[1] && all[1] >= all[0])
    return { kind: "range", startDate: all[0], endDate: all[1], value };
  return { kind: "unrecognized", value };
}

// Two server-rendered layouts share one event identity (the /events/<slug>/ page):
//   archive  : .container-event > h4 a, h6 venue, h6 date
//   search   : .search-result > h3.event-title a, .search-result-meta p.emphasize-result
export function parseVisitSeattle({ html, url, config, task }) {
  const $ = load(html),
    records = [],
    issues = [],
    excluded = {};
  let count = 0,
    rejected = 0,
    unrecognized = 0;
  const bump = (key) => (excluded[key] = (excluded[key] ?? 0) + 1);
  const add = (title, href, venue, rawDate, summary, selector) => {
    count++;
    const parsed = parseSeattleDate(rawDate);
    if (parsed.kind === "ongoing" || parsed.kind === "now-through") {
      bump(
        parsed.kind === "ongoing"
          ? "ongoingWithoutDates"
          : "nowThroughWithoutStart",
      );
      return;
    }
    if (!parsed.startDate) {
      unrecognized++;
      return;
    }
    const record = eventRecord(
      config,
      {
        title,
        url: href,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        dateTimeBasis: {
          start: "visible listing date",
          end: "visible listing date/range",
        },
        location: venue
          ? { venue, basis: "upstream listing venue line" }
          : undefined,
        raw: { date: parsed.value, venue, summary },
      },
      { url, selector },
    );
    if (record) records.push(record);
    else rejected++;
  };
  const archive = $(".container-event");
  archive.each((_, el) => {
    const c = $(el),
      a = c.find("h4 a").first(),
      lines = c
        .find("h6")
        .map((_, e) => text($(e).text()))
        .get();
    add(
      a.text(),
      a.attr("href"),
      lines.length > 1 ? lines[0] : "",
      lines.at(-1),
      text(c.find("p").first().text()),
      ".container-event h4 a + h6 lines",
    );
  });
  const search = $(".search-result-container .search-result");
  search.each((_, el) => {
    const c = $(el),
      a = c.find("h3.event-title a").first(),
      lines = c
        .find(".search-result-meta p.emphasize-result")
        .map((_, e) => text($(e).text()))
        .get(),
      rawDate = lines.find((l) => /\d{1,2}\/\d{1,2}\/\d{4}|ongoing/i.test(l)),
      venue = lines.find((l) => l !== rawDate);
    add(
      a.text(),
      a.attr("href"),
      venue,
      rawDate ?? "",
      text(c.find(".search-result-meta p:not(.emphasize-result)").text()),
      ".search-result h3.event-title + p.emphasize-result",
    );
  });
  // Exactly one list layout must be present; an unrecognised page is not
  // an empty calendar.
  if (!archive.length && !search.length)
    issues.push({ code: "expected_source_cards_missing" });
  if (archive.length && search.length)
    issues.push({ code: "mixed_listing_layouts" });
  if (unrecognized)
    issues.push({ code: "listing_date_unrecognized", count: unrecognized });
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  // Header "Events (N)" appears only on the search layout; it is the
  // publisher's own total for the whole query across its result pages.
  const headerTotal = (() => {
    const header = $(".search-results-event .block-header h2")
      .first()
      .text()
      .match(/Events\s*\((\d+)\)/i);
    return header ? Number(header[1]) : null;
  })();
  const seenBefore = Number(task?.meta?.seenBefore ?? 0),
    seen = seenBefore + count;
  const nav = $("ol.grav_page_navi");
  const next = nav.find("li.bpn-next-link a[href]").first().attr("href");
  const nextUrl = next ? safeUrl(next, url) : null;
  const nextRequests = nextUrl
    ? [
        {
          url: nextUrl,
          kind: "listing",
          depth: task?.depth ?? 0,
          meta: {
            pagination: true,
            seenBefore: seen,
            headerTotal: headerTotal ?? task?.meta?.headerTotal ?? null,
          },
        },
      ]
    : [];
  const total = headerTotal ?? task?.meta?.headerTotal ?? null;
  const terminal = !!nav.length && !nextUrl;
  // Every page of a query whose own total the publisher prints is "verified-list";
  // the run still cannot finish unless the final page reconciles that total with
  // every card observed across the pages followed from page one.
  const reconciled = !terminal || seen === total;
  if (terminal && total != null && seen !== total)
    issues.push({ code: "listing_total_mismatch", expected: total, seen });
  const coverage =
    total != null && reconciled && !unrecognized && !rejected
      ? "verified-list"
      : "unverified";
  return {
    records,
    method: "visitseattle-listing",
    observedCount: count,
    rejected,
    issues,
    coverage,
    terminal,
    nextRequests,
    ...(Object.keys(excluded).length ? { excluded } : {}),
  };
}

// A sitemap lists detail pages; each page is then read by the ordinary detail
// parser. A sitemap proves only that these pages are published, not that they are
// every event, so coverage stays unverified.
export function parseSitemapEntries({ body, url, config }) {
  const $ = load(body, { xmlMode: true });
  const pattern = new RegExp(config.detailPattern);
  const locs = $("url > loc")
    .map((_, e) => text($(e).text()))
    .get();
  const nested = $("sitemap > loc")
    .map((_, e) => text($(e).text()))
    .get();
  if (!locs.length && !nested.length)
    throw Object.assign(new Error("Sitemap contains no <loc> entries"), {
      code: "contract_changed",
    });
  const seen = new Set(),
    nextRequests = [];
  // A sitemap index points at child sitemaps; same-host children are queued as
  // further sitemap tasks so discovery reaches the event-detail sitemaps.
  const host = new URL(url).hostname;
  for (const loc of nested) {
    const u = safeUrl(loc, url);
    if (!u || new URL(u).hostname !== host || seen.has(u)) continue;
    seen.add(u);
    nextRequests.push({
      url: u,
      kind: "api",
      depth: 0,
      meta: { discoveredOn: url, sitemapIndex: true },
    });
  }
  for (const loc of locs) {
    const u = safeUrl(loc, url);
    if (!u || !pattern.test(new URL(u).pathname) || seen.has(u)) continue;
    seen.add(u);
    nextRequests.push({
      url: u,
      kind: "detail",
      depth: 1,
      meta: { discoveredOn: url, sitemap: true },
    });
  }
  return {
    records: [],
    nextRequests,
    method: "sitemap-detail-discovery",
    observedCount: nextRequests.filter((r) => r.kind === "detail").length,
    rejected: 0,
    issues: nextRequests.length
      ? []
      : [{ code: "sitemap_without_matching_urls" }],
    coverage: "unverified",
    terminal: false,
    scopeWarning: `Sitemap lists ${locs.length} URLs, ${nextRequests.length} match the event detail pattern; the sitemap is not a proven complete event catalogue`,
  };
}

const pad = (n) => String(n).padStart(2, "0");
// Convert an instant to local wall-clock "YYYY-MM-DDTHH:MM:SS" in a zone.
function localParts(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

// Dallas City Hall calendar: the page itself reads this public SharePoint list.
// EventDate/EndDate are true UTC instants (a 9 a.m. CST item is 15:00Z).
export function parseSharePointCalendar({ body, url, config }) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("SharePoint API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  if (!Array.isArray(data?.value))
    throw Object.assign(new Error("SharePoint list items missing"), {
      code: "contract_changed",
    });
  const records = [],
    issues = [];
  let unexpanded = 0;
  let rejected = 0;
  const origin = new URL(url).origin,
    detailBase =
      config.detailBase ?? `${origin}/calendar/Pages/Event-Details.aspx`;
  for (const item of data.value) {
    const start = new Date(item.EventDate),
      end = item.EndDate ? new Date(item.EndDate) : null;
    if (
      !item.Title ||
      !Number.isFinite(item.Id) ||
      Number.isNaN(start.getTime()) ||
      (end && Number.isNaN(end.getTime()))
    ) {
      rejected++;
      continue;
    }
    const allDay = item.fAllDayEvent === true;
    // SharePoint all-day items are stored at local midnight, which is a UTC
    // instant; the visible all-day date is the local calendar date.
    const s = localParts(start, config.timeZone),
      e = end ? localParts(end, config.timeZone) : null;
    const address = [item.Address1, item.Address2].filter(Boolean).join(", ");
    const warnings = [];
    if (item.fRecurrence === true) {
      warnings.push("recurring_series_item_not_expanded");
      unexpanded++;
    }
    if (item.EventStatus && item.EventStatus !== "Active")
      warnings.push(
        `source_event_status_${String(item.EventStatus).toLowerCase()}`,
      );
    if (item.IsApproved && item.IsApproved !== "Approved")
      warnings.push("source_approval_state_not_approved");
    const record = eventRecord(
      config,
      {
        id: `${item.Id}|${s.date}|${allDay ? "" : s.time}`,
        title: item.Title,
        url: `${detailBase}?EID=${item.Id}`,
        startDate: s.date,
        endDate: e && e.date >= s.date ? e.date : undefined,
        startLocal: allDay ? undefined : `${s.date}T${s.time}`,
        endLocal:
          allDay || !e || e.date < s.date ? undefined : `${e.date}T${e.time}`,
        allDay,
        dateTimeBasis: {
          start:
            "source EventDate UTC instant converted to the collection time zone",
          end: e
            ? "source EndDate UTC instant converted to the collection time zone"
            : null,
        },
        location: {
          venue: item.Location,
          streetAddress: address || undefined,
          locality: item.City,
          region: item.State,
          postalCode:
            item.Zip == null ? undefined : String(Math.trunc(item.Zip)),
          basis: "upstream list item location fields",
        },
        geoCoordinates:
          item.Latitude != null && item.Longitude != null
            ? { latitude: item.Latitude, longitude: item.Longitude }
            : null,
        categoryTags: item.EventType0
          ? [{ label: item.EventType0, basis: "upstream EventType" }]
          : [],
        warnings,
        raw: {
          id: item.Id,
          eventDate: item.EventDate,
          endDate: item.EndDate,
          allDay: item.fAllDayEvent,
          recurrence: item.fRecurrence,
          status: item.EventStatus,
          approval: item.IsApproved,
          website: item.EventWebsiteURL2 ?? item.OnlineEventURL ?? null,
        },
      },
      { url, selector: "SharePoint list items" },
    );
    if (record) records.push(record);
    else rejected++;
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  // Future instances of a recurring series were not collected: not complete.
  if (unexpanded)
    issues.push({ code: "recurring_series_not_expanded", count: unexpanded });
  const next = data["odata.nextLink"];
  const nextUrl = next ? safeUrl(next, url) : null;
  return {
    records,
    nextRequests: nextUrl
      ? [{ url: nextUrl, kind: "api", depth: 0, meta: { pagination: true } }]
      : [],
    method: "sharepoint-list-rest",
    observedCount: data.value.length,
    rejected,
    issues,
    coverage: "api-query",
    terminal: !nextUrl,
    scopeWarning:
      "Items with EventDate on or after the as-of date; recurring list items are not expanded and the list holds only entries its editors published",
  };
}

// Visit Dallas (Simpleview) Event JSON-LD, inspected November 5, 2026, repeats the
// event title as the venue name and street address, and writes a date-only claim
// as a 00:00:00 to 23:59:59 span. Neither is a venue or a clock time, so the span
// becomes an all-day date claim and the venue comes from the page's own visible
// address block, or is withheld when that block is absent or ambiguous.
export function refineSimpleviewEvent($, event) {
  const refined = { ...event };
  const day = (value) => String(value ?? "").slice(0, 10);
  if (
    /^\d{4}-\d\d-\d\dT00:00:00(?:Z|[+-]\d\d:\d\d)?$/.test(
      event.startDate ?? "",
    ) &&
    /^\d{4}-\d\d-\d\dT23:59:59(?:Z|[+-]\d\d:\d\d)?$/.test(event.endDate ?? "")
  ) {
    refined.startDate = day(event.startDate);
    refined.endDate = day(event.endDate);
    refined.allDay = true;
  }
  const loc = event.location;
  const title = text(event.name).toLowerCase();
  const echoes = (value) =>
    typeof value === "string" && text(value).toLowerCase() === title;
  if (
    loc &&
    typeof loc === "object" &&
    (echoes(loc.name) ||
      echoes(loc.address) ||
      echoes(loc.address?.streetAddress))
  ) {
    const blocks = $(".detail__address");
    if (blocks.length === 1) {
      const venue = text(blocks.find(".location").first().text());
      const spans = blocks
        .find("span:not(.location)")
        .map((_, e) => text($(e).text()))
        .get()
        .filter(Boolean);
      const cityLine = spans
        .at(-1)
        ?.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      refined.location = {
        "@type": "Place",
        name: venue && !echoes(venue) ? venue : undefined,
        address: {
          streetAddress: cityLine && spans.length > 1 ? spans[0] : undefined,
          addressLocality: cityLine?.[1],
          addressRegion: cityLine?.[2],
          postalCode: cityLine?.[3],
        },
      };
    } else refined.location = undefined;
  }
  return refined;
}
