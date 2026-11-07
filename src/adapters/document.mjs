import { load } from "cheerio";
import { inspectedAdapters, parseInspected } from "./inspected.mjs";
import { parseDetail } from "./detail.mjs";
import { parseDcListing } from "./washington.mjs";
import { parseEventbriteSearch } from "./eventbrite.mjs";
import { parseJavitsMonth } from "./javits.mjs";
import { parseStreetFairs } from "./street-fairs.mjs";
import { parseCityGuide } from "./cityguide.mjs";
import { inspectedPagination } from "./pagination.mjs";
import {
  parseLaCalendar,
  parseBostonCalendar,
  parseTimeRange,
} from "../../examples/parsers.mjs";
import {
  text,
  dates,
  safeUrl,
  eventRecord,
  jsonLdEvents,
  recordFromJsonLd,
  dedupe,
} from "../records.mjs";

const paginationSelectors =
  'a[rel="next"],.pager__item--next a,.tribe-events-c-nav__next a,a.tribe-events-c-nav__next,.pagination .next a,a.next.page-numbers,.pagination-next a';
const inScope = (url, config) =>
  [new URL(config.url).hostname, ...(config.allowedHosts ?? [])].some(
    (host) =>
      host.replace(/^www\./, "") ===
      new URL(url).hostname.replace(/^www\./, ""),
  );
function navigation($, url, config, task) {
  const requests = [];
  $(paginationSelectors).each((_, e) => {
    const href = $(e).attr("href"),
      u = href && !href.startsWith("#") ? safeUrl(href, url) : null;
    if (u && inScope(u, config) && u !== url)
      requests.push({
        url: u,
        kind: "listing",
        depth: task.depth,
        meta: { pagination: true },
      });
  });
  return requests;
}
function normalizedLegacy(config, records, url) {
  return records
    .map((r) => {
      const record = eventRecord(
        config,
        { ...r, id: r.sourceRecordId },
        { ...r.evidence, url },
      );
      if (!record)
        throw Object.assign(
          new Error("Inspected event has invalid date/time fields"),
          { code: "data_quality_error" },
        );
      return record;
    })
    .map((r) => ({ ...r, validationStatus: "parser-validated" }));
}
export function parseDocument({
  html,
  url,
  config,
  task = { depth: 0, kind: "listing", meta: {} },
  interaction,
}) {
  if (task.kind === "detail") return parseDetail({ html, url, config });
  if (config.adapter === "cityguide")
    return parseCityGuide({ html, url, config });
  if (config.adapter === "dothis-street-fairs")
    return parseStreetFairs({ html, url, config });
  if (
    config.adapter === "javits" &&
    config.pagination?.mode === "javits-months"
  )
    return parseJavitsMonth({ html, url, config, task });
  const $ = load(html),
    issues = [],
    all = [],
    nextRequests = navigation($, url, config, task);
  let coverage = config.coverage,
    terminal = false,
    observedCount = 0,
    method = "jsonld",
    rejected = 0,
    emptyTerminalPage = false,
    excluded;
  if (config.discoveryOnly) {
    method = "discovery-only";
    coverage = "discovery";
  } else if (inspectedAdapters.has(config.adapter)) {
    const parsed = parseInspected({ html, url, config, interaction, task });
    all.push(...parsed.records);
    issues.push(
      ...parsed.issues.filter(
        (issue) => issue.code !== "records_require_parse_review",
      ),
    );
    observedCount = parsed.observedCount;
    method = parsed.method;
    rejected = parsed.rejected;
    nextRequests.push(...(parsed.nextRequests ?? []));
    coverage = parsed.coverage;
    terminal = parsed.terminal;
    excluded = parsed.excluded;
  } else if (config.adapter === "la") {
    const parsed = parseLaCalendar(html, url);
    all.push(...normalizedLegacy(config, parsed.records, url));
    observedCount = parsed.observedCount;
    terminal = true;
    method = "la-event-cards";
  } else if (config.adapter === "boston") {
    const parsed = parseBostonCalendar(html, url);
    all.push(...normalizedLegacy(config, parsed.records, url));
    observedCount = parsed.observedCount;
    if (parsed.nextUrl && !nextRequests.some((p) => p.url === parsed.nextUrl))
      nextRequests.push({
        url: parsed.nextUrl,
        kind: "listing",
        depth: task.depth,
        meta: { pagination: true },
      });
    terminal = !parsed.nextUrl;
    method = "boston-occurrence-cards";
  } else if (config.adapter === "festivalindex") {
    const cards = $("[data-event-payload]");
    observedCount = cards.length;
    method = "festivalindex-payload";
    cards.each((_, e) => {
      try {
        const v = JSON.parse($(e).attr("data-event-payload"));
        const r = eventRecord(
          config,
          {
            id: String(v.id),
            title: v.title,
            url: v.url,
            rawDate: v.date_text,
            location: {
              locality: v.location_text,
              country: v.country_code,
              basis: "upstream card payload",
            },
            categoryTags: (v.topics ?? []).map((t) => ({
              label: t.label,
              slug: t.slug,
              basis: "upstream topic",
            })),
            raw: v,
          },
          { url, selector: "[data-event-payload]" },
        );
        r ? all.push(r) : rejected++;
      } catch {
        rejected++;
      }
    });
  } else if (config.adapter === "dc-tourism" && $(".dcevent-wrapper").length) {
    const parsed = parseDcListing($, url, config);
    method = "dc-listing-cards";
    all.push(...parsed.records);
    observedCount = parsed.observedCount;
    rejected += parsed.rejected;
  } else if (config.adapter === "dc-tourism") {
    method = "dc-calendar-cards";
    const cards = $(".event-wrapper");
    observedCount = cards.length;
    cards.each((_, e) => {
      const c = $(e),
        a = c.find(".event-title a").first();
      const rawDate = `${text(c.find(".date__input--month").text())} ${text(c.find(".date__input--day").text())}, ${text(c.find(".date__input--year").text())}`;
      const r = eventRecord(
        config,
        {
          title: a.text(),
          url: a.attr("href"),
          rawDate,
          location: {
            venue: text(c.find(".event-location").text()),
            basis: "source event card",
          },
        },
        { url, selector: ".event-wrapper" },
      );
      r ? all.push(r) : rejected++;
    });
  } else if (config.adapter === "eventbrite-search") {
    const parsed = parseEventbriteSearch({ html, url, config });
    all.push(...parsed.records);
    observedCount = parsed.observedCount;
    rejected = parsed.rejected;
    nextRequests.length = 0;
    nextRequests.push(...parsed.nextRequests);
    coverage = parsed.coverage;
    terminal = parsed.terminal;
    method = "eventbrite-search-results";
    if (parsed.capped)
      issues.push({
        code: "search_view_capped",
        objectCount: parsed.objectCount,
        message: "Eventbrite serves fewer pages than the advertised total",
      });
  } else if (config.adapter === "vegas-festival-guide") {
    // Editorial guide: each festival is an <h3 id> followed by a paragraph of
    // "<strong>When|Date(s):</strong> value" lines. Only fully dated entries
    // (day and year stated) become observations; "TBD"/"Postponed" entries
    // are counted as undated and never given invented dates.
    method = "vegas-festival-guide";
    $("h3[id]").each((_, e) => {
      const h = $(e),
        meta = h.nextAll("p").first(),
        html = meta.html() ?? "";
      if (!/<strong>\s*(?:When|Dates?)\s*:/i.test(html)) return;
      const lines = html.split(/<br\s*\/?>/i).map((l) => load(`<p>${l}</p>`));
      const where = lines
        .map(($l) => text($l("p").text()))
        .map((l) => l.match(/^Where:\s*(.+)$/i)?.[1])
        .find(Boolean);
      for (const $l of lines) {
        const line = text($l("p").text()),
          m = line.match(/(?:^|\|\s*)(?:When|Dates?):\s*(.+)$/i);
        if (!m) continue;
        observedCount++;
        const sub = line.match(/^(.+?)\s*\|\s*(?:When|Dates?):/i)?.[1];
        if (!dates(m[1]).startDate) continue;
        const id = `${h.attr("id")}${
          sub
            ? `-${text(sub)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")}`
            : ""
        }`;
        const r = eventRecord(
          config,
          {
            id,
            title: sub ? `${text(h.text())} - ${text(sub)}` : h.text(),
            url: `${url.split("#")[0]}#${id}`,
            rawDate: m[1],
            location: where
              ? { venue: where, basis: "guide section 'Where' line" }
              : undefined,
          },
          { url, selector: "h3[id] + p" },
        );
        r ? all.push(r) : rejected++;
      }
    });
  } else if (config.adapter === "javits") {
    method = "javits-calendar-cards";
    const titles = $("h3.uppercase");
    observedCount = titles.length;
    titles.each((_, e) => {
      const h = $(e),
        parent = h.parent(),
        rawDate = text(h.prev().text()),
        a = parent.find("a[href]").first();
      const r = eventRecord(
        config,
        {
          title: h.text(),
          url: a.attr("href") ?? `${url}#${encodeURIComponent(text(h.text()))}`,
          rawDate,
          location: {
            venue: "Jacob K. Javits Convention Center",
            locality: "New York City",
            region: "NY",
            country: "US",
            basis: "single-venue source",
          },
        },
        { url, selector: "h3.uppercase and previous date element" },
      );
      r ? all.push(r) : rejected++;
    });
  } else if (config.adapter === "microdata") {
    method = "microdata-event";
    const cards = $('[itemtype*="schema.org/Event"]');
    observedCount = cards.length;
    cards.each((_, e) => {
      const c = $(e),
        prop = (name) => {
          const x = c.find(`[itemprop="${name}"]`).first();
          return (
            x.attr("content") ??
            x.attr("datetime") ??
            x.attr("href") ??
            text(x.text())
          );
        };
      const location = c.find('[itemprop="location"]').first();
      const locationProp = (name) => {
        const x = location.find(`[itemprop~="${name}"]`).first();
        return x.attr("content") ?? text(x.text());
      };
      const venueText = location.clone();
      venueText.find('[itemprop="address"]').remove();
      const latitude = locationProp("latitude"),
        longitude = locationProp("longitude");
      const r = eventRecord(
        config,
        {
          title: prop("name"),
          url: prop("url") || c.find("a[href]").first().attr("href"),
          startDate: prop("startDate"),
          endDate: prop("endDate"),
          location: {
            locality: locationProp("addressLocality"),
            region: locationProp("addressRegion"),
            country: locationProp("addressCountry"),
            postalCode: locationProp("postalCode"),
            address: locationProp("streetAddress"),
            venue: locationProp("name") || text(venueText.text()),
            basis: "microdata",
          },
          geoCoordinates:
            latitude || longitude ? { latitude, longitude } : null,
        },
        { url, selector: "[itemtype*=schema.org/Event]" },
      );
      r ? all.push(r) : rejected++;
    });
    // NYC Parks aggregate pages state their total ("Currently viewing N
    // events") and are fetched page by page until an empty page. The stated
    // total must equal the cards actually collected before coverage is known.
    if (config.pagination?.mode === "nycparks-aggregate") {
      const page = Number(url.match(/\/p(\d+)\/?(?:[?#].*)?$/)?.[1]);
      const stated = Number(
        text($.root().text()).match(/Currently viewing (\d+) events?/i)?.[1],
      );
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > config.pagination.maxPages
      )
        throw Object.assign(new Error("NYC Parks page contract missing"), {
          code: "pagination_changed",
        });
      coverage = "verified-list";
      if (cards.length) {
        if (page === 1 && stated !== cards.length)
          issues.push({
            code: "listed_total_not_reconciled",
            stated: Number.isFinite(stated) ? stated : null,
            cards: cards.length,
          });
        nextRequests.push({
          url: url.replace(/\/p\d+(\/?(?:[?#].*)?)$/, `/p${page + 1}$1`),
          kind: "listing",
          depth: 0,
          meta: { pagination: true },
        });
      } else {
        terminal = true;
        coverage = "verified-list";
        emptyTerminalPage = true;
      }
    }
  } else {
    const ld = jsonLdEvents(html);
    observedCount = ld.events.length;
    for (const { event, path } of ld.events) {
      const r = recordFromJsonLd(
        config,
        event,
        { url, jsonPath: path },
        ld.references,
      );
      r ? all.push(r) : rejected++;
    }
    if (ld.parseErrors.length)
      issues.push({
        code: "malformed_structured_data",
        count: ld.parseErrors.length,
      });
    if (
      !all.length ||
      config.adapter === "cards" ||
      config.adapter === "conventiongrid" ||
      config.adapter === "trade-table"
    ) {
      const pattern = new RegExp(config.detailPattern),
        selectors = config.cardSelectors ?? [
          ".event-card",
          ".event-item",
          ".views-row",
          "article",
          "table tr",
        ];
      let roots = [];
      if (config.adapter === "conventiongrid") {
        roots = $('a[href^="/shows/"]')
          .filter((_, e) => dates($(e).text()).startDate)
          .toArray();
      } else if (config.adapter === "trade-table") {
        roots = $("table tr")
          .filter(
            (_, e) =>
              $(e).find("table").length === 0 && dates($(e).text()).startDate,
          )
          .toArray();
      } else
        for (const selector of selectors) {
          const found = $(selector).toArray();
          if (found.length) {
            roots = found;
            break;
          }
        }
      observedCount += roots.length;
      for (const el of roots) {
        const c = $(el),
          a =
            el.tagName === "a"
              ? c
              : c
                  .find("a[href]")
                  .filter((_, a) => pattern.test($(a).attr("href")))
                  .first();
        const href = a.attr("href");
        if (!href) continue;
        const visible = c.clone();
        visible
          .find(
            'script,style,noscript,template,[itemprop="datePublished"],[itemprop="dateModified"],time[pubdate],.published,.updated,.post-date',
          )
          .remove();
        const title =
          (config.adapter === "conventiongrid"
            ? text(c.find(".font-medium").first().text())
            : "") ||
          text(c.find('h2,h3,h4,[class*="title"]').first().text()) ||
          text(a.text()).slice(0, 200);
        const time = visible
          .find('time,[itemprop="startDate"],[datetime],[data-date]')
          .filter(
            (_, e) =>
              !/datePublished|dateModified|endDate|published|updated/i.test(
                `${$(e).attr("itemprop") ?? ""} ${$(e).attr("class") ?? ""}`,
              ),
          )
          .first();
        const dateText = text(visible.find('[class*="date"]').text());
        const attributeStart =
          time.attr("datetime") ??
          time.attr("content") ??
          time.attr("data-date");
        const rawDate =
          attributeStart ??
          (dateText ||
            (["conventiongrid", "trade-table"].includes(config.adapter)
              ? text(visible.text())
              : ""));
        const range = dates(rawDate),
          visibleRange = dates(dateText),
          clocks = parseTimeRange(dateText || visible.text());
        const explicitEnd = visible.find('[itemprop="endDate"]').first();
        const endAttribute =
          explicitEnd.attr("datetime") ?? explicitEnd.attr("content");
        const endClockSafe =
          clocks.endTime &&
          (visibleRange.endDate > range.startDate ||
            clocks.endTime >= clocks.startTime);
        const visibleEnd =
          visibleRange.startDate &&
          (visibleRange.endDate !== visibleRange.startDate || endClockSafe)
            ? visibleRange.endDate
            : null;
        const endDate =
          endAttribute ??
          (attributeStart && visibleEnd ? visibleEnd : undefined);
        const endDay =
          dates(endDate).startDate ?? (!attributeStart ? range.endDate : null);
        const r = eventRecord(
          config,
          {
            id: c.attr("data-event-id"),
            title,
            url: href,
            rawDate,
            rawDateBasis: attributeStart
              ? "start_attribute"
              : "visible_listing",
            startDate: attributeStart,
            endDate,
            dateTimeBasis: {
              start: attributeStart
                ? "start attribute"
                : "visible listing date",
              end: endAttribute
                ? "end attribute"
                : attributeStart
                  ? visibleEnd
                    ? "visible listing date/time range"
                    : null
                  : "visible listing date/range",
            },
            startLocal:
              !/^\d{4}-\d\d-\d\dT/.test(attributeStart ?? "") &&
              clocks.startTime &&
              range.startDate
                ? `${range.startDate}T${clocks.startTime}`
                : undefined,
            endLocal:
              !/^\d{4}-\d\d-\d\dT/.test(endAttribute ?? "") &&
              endClockSafe &&
              endDay
                ? `${endDay}T${clocks.endTime}`
                : undefined,
            location: {
              venue: text(visible.find(".venue,.event-venue").first().text()),
              formattedAddress: text(
                visible
                  .find('.event-location,.location,[itemprop="location"]')
                  .first()
                  .text(),
              ),
              basis: "event card location element",
            },
            warnings:
              clocks.endTime && !endClockSafe
                ? ["end_time_requires_date_review"]
                : [],
            raw: { cardText: text(visible.text()).slice(0, 4000) },
          },
          {
            url,
            selector:
              config.adapter === "conventiongrid"
                ? "a[href^=/shows/]"
                : selectors.join(","),
          },
        );
        if (r) {
          all.push(r);
          method = "semantic-event-cards";
        } else rejected++;
      }
    }
    if (config.adapter === "tribe") {
      method = "tribe-list-jsonld";
      if (
        !$(".tribe-events-view").length &&
        !$(".tribe-events").length &&
        !ld.events.length
      ) {
        const e = new Error("Expected TEC calendar or Event JSON-LD missing");
        e.code = "contract_changed";
        throw e;
      }
      const interactive =
        $(".tribe-events-c-nav__next:not([disabled])").length &&
        !nextRequests.length;
      terminal = !nextRequests.length && !interactive;
      if (interactive) {
        issues.push({ code: "interactive_pagination_unresolved" });
        coverage = "unverified";
      }
    }
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  const paging = inspectedPagination($, url, config, task);
  if (paging) {
    const details = nextRequests.filter((r) => r.kind === "detail");
    nextRequests.splice(
      0,
      nextRequests.length,
      ...paging.nextRequests,
      ...details,
    );
    coverage = paging.coverage;
    terminal = paging.terminal;
  }
  if (config.listingContract && !$(config.listingContract).length)
    throw Object.assign(
      new Error(`Listing contract missing: ${config.listingContract}`),
      { code: "contract_changed" },
    );
  const pattern = new RegExp(config.detailPattern),
    discovered = [];
  $(
    "main a[href],article a[href],.view-content a[href],.event-card a[href],a[href]",
  ).each((_, e) => {
    const href = $(e).attr("href");
    if (!href || href.startsWith("#") || !pattern.test(href)) return;
    const u = safeUrl(href, url);
    if (!u || !inScope(u, config) || u === url) return;
    if (/\/wp-admin\/|\/user\/|\/login|\/cart|\.pdf(?:\?|$)/i.test(u)) return;
    discovered.push({
      url: u,
      kind: "detail",
      depth: task.depth + 1,
      meta: { discoveredOn: url, titleHint: text($(e).text()).slice(0, 150) },
    });
  });
  // Never label unknown discovery navigation as a complete event catalogue.
  if (
    config.discoverDetails !== false &&
    !["la", "boston", "tribe"].includes(config.adapter) &&
    task.depth < config.maxDepth
  ) {
    const knownUrls = new Set(all.map((r) => r.url));
    nextRequests.push(...discovered.filter((r) => !knownUrls.has(r.url)));
  }
  if (
    config.enrichDetails &&
    task.kind === "listing" &&
    task.depth < config.maxDepth
  ) {
    const targets = all.filter(
      (r) =>
        r.fieldQuality?.needsDetail &&
        inScope(r.url, config) &&
        !new URL(r.url).hash,
    );
    for (const targetUrl of new Set(targets.map((r) => r.url)))
      if (targetUrl !== url)
        nextRequests.push({
          url: targetUrl,
          kind: "detail",
          depth: task.depth + 1,
          meta: {
            enrichRecordIds: targets
              .filter((r) => r.url === targetUrl)
              .map((r) => r.sourceRecordId),
            discoveredOn: url,
          },
        });
  }
  if (
    !all.length &&
    !nextRequests.length &&
    !emptyTerminalPage &&
    !(observedCount && excluded)
  )
    issues.push({
      code: "no_event_contract_found",
      message:
        "Inspect source, embeds, network calls and event-specific sections",
    });
  if (
    $("iframe[src]")
      .toArray()
      .some((el) => {
        try {
          const frame = new URL($(el).attr("src"), url);
          return (
            /(?:^|\.)trumba\.com$|(?:^|\.)localist\.com$/.test(
              frame.hostname,
            ) || /\/(?:calendar|events)(?:\/|\.|$)/i.test(frame.pathname)
          );
        } catch {
          return false;
        }
      })
  )
    issues.push({ code: "embedded_calendar_requires_validation" });
  const uniqueRequests = new Map();
  const priority = (p) =>
    p.kind === "listing" ? 0 : p.meta?.enrichRecordIds ? 1 : 2;
  for (const request of nextRequests.sort((a, b) => priority(a) - priority(b)))
    if (!uniqueRequests.has(request.url))
      uniqueRequests.set(request.url, request);
  return {
    records: dedupe(all),
    nextRequests: [...uniqueRequests.values()],
    method,
    observedCount,
    rejected,
    issues,
    coverage,
    terminal,
    ...(excluded ? { excluded } : {}),
    discoveryLinks: [...new Set(discovered.map((r) => r.url))].slice(0, 100),
  };
}
