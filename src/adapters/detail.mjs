import { load } from "cheerio";
import {
  dates,
  text,
  safeUrl,
  eventRecord,
  jsonLdEvents,
  recordFromJsonLd,
} from "../records.mjs";
import { parseTimeRange } from "../../examples/parsers.mjs";
import { refineSimpleviewEvent } from "./regional.mjs";
import {
  mergeDetail,
  fieldQuality,
  sameOccurrenceTime,
} from "../event-fields.mjs";

// Some structured data states an instant in UTC while the page shows venue-local
// time. Convert only when the adapter declares it, using the collection zone,
// and drop an end identical to the start (no real end was supplied).
function localTimestamp(instant, timeZone) {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms) || !/Z$/.test(instant)) return null;
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
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
function localizeUtcEvent(event, timeZone) {
  const start = localTimestamp(String(event.startDate ?? ""), timeZone);
  if (!start) return event;
  const sameEnd = event.endDate === event.startDate;
  const end = sameEnd
    ? null
    : localTimestamp(String(event.endDate ?? ""), timeZone);
  const { endDate: _dropped, ...rest } = event;
  return {
    ...rest,
    startDate: start,
    ...(end ? { endDate: end } : {}),
    sourceUtc: { startDate: event.startDate, endDate: event.endDate ?? null },
    timeZone,
    timeZoneBasis:
      "structured UTC instant converted to the collection time zone",
    dateTimeBasis: {
      start: "structured UTC instant converted to venue-local time",
      end: end ? "structured UTC instant converted to venue-local time" : null,
    },
    warnings: [
      "utc_instant_converted_to_collection_time_zone",
      ...(sameEnd ? ["source_end_equals_start_ignored"] : []),
    ],
  };
}
const canonical = (value) => {
  const u = new URL(value);
  u.hash = "";
  return u.href.replace(/\/$/, "");
};
const labelled = ($, name) =>
  text(
    $("p")
      .filter((_, e) => text($(e).text()) === name)
      .first()
      .next("p")
      .text(),
  );
// A labelled "Time" value such as "7:30 p.m." or "10 a.m. - 8 p.m." supplies
// clocks for a single-day, date-only structured Event. Several sessions or a
// multi-day range are left at day precision. A visible "City, ST ZIP" label
// that shares the structured postal code but names another city replaces the
// structured locality, which the aggregator was seen to default to Orlando.
function withVisibleDetails($, event) {
  const start = String(event.startDate ?? ""),
    end = String(event.endDate ?? start);
  let result = event;
  const place = labelled($, "Location").match(
    /^(.+?),\s*([A-Z]{2})\s+(\d{5})$/,
  );
  const loc = event.location;
  if (
    place &&
    loc &&
    !Array.isArray(loc) &&
    typeof loc === "object" &&
    loc.address?.postalCode === place[3] &&
    loc.address.addressLocality !== place[1]
  )
    result = {
      ...result,
      location: {
        ...loc,
        address: {
          ...loc.address,
          addressLocality: place[1],
          addressRegion: place[2],
        },
      },
    };
  if (!/^\d{4}-\d\d-\d\d$/.test(start) || end.slice(0, 10) !== start)
    return result;
  const label = labelled($, "Time").replace(/\b([ap])\.m\./gi, "$1m");
  const clock = "\\d{1,2}(?::\\d{2})?\\s*[ap]m";
  if (!new RegExp(`^${clock}(?:\\s*[-\u2013]\\s*${clock})?$`, "i").test(label))
    return result;
  const clocks = parseTimeRange(label);
  if (!clocks.startTime) return result;
  return {
    ...result,
    startDate: `${start}T${clocks.startTime}`,
    endDate: clocks.endTime ? `${start}T${clocks.endTime}` : result.endDate,
    dateTimeBasis: {
      start: "visible detail time label",
      end: clocks.endTime ? "visible detail time label" : "structured date",
    },
  };
}
export function parseDetail({ html, url, config }) {
  const $ = load(html),
    ld = jsonLdEvents(html),
    records = [],
    issues = [];
  const title = text($("main h1,h1").first().text());
  const profile =
    config.sourceKey === "boston.gov" && $(".event-detail-page").length
      ? "boston"
      : config.adapter;
  for (const { event, path } of ld.events) {
    const own = safeUrl(event.url, url) ?? safeUrl(event["@id"], url);
    // On a detail page, an Event without a URL can use the page's own identity
    // only when it is the sole Event and agrees with the main heading.
    const fallback =
      !own &&
      ld.events.length === 1 &&
      text(event.name).toLowerCase() === title.toLowerCase();
    // An aggregator may declare the upstream publisher's own URL in its Event.
    // With this opt-in, the sole Event whose name agrees with the page heading
    // is the page's Event, and keeps the upstream URL as its stable identity.
    const titled =
      config.detailEventIdentity === "page-title" &&
      own &&
      ld.events.length === 1 &&
      text(event.name).toLowerCase() === title.toLowerCase();
    if (!fallback && !titled && (!own || canonical(own) !== canonical(url)))
      continue;
    const prepared =
      config.localizeUtcInstants && config.timeZone
        ? localizeUtcEvent(event, config.timeZone)
        : event;
    const source = titled
      ? withVisibleDetails($, prepared)
      : fallback
        ? { ...prepared, url }
        : prepared;
    const record = recordFromJsonLd(
      config,
      config.detailProfile === "simpleview"
        ? refineSimpleviewEvent($, source)
        : source,
      { url, jsonPath: path },
      ld.references,
    );
    if (record) records.push(record);
  }
  let method = "detail-jsonld";
  if (
    new URL(url).hostname === "all.events" &&
    records.length > 1 &&
    records.some((r) => /Z$/.test(r.startLocal ?? ""))
  )
    throw Object.assign(
      new Error(
        "Ambiguous AllEvents UTC markup requires a reviewed visible occurrence contract",
      ),
      { code: "contract_changed" },
    );
  if (new URL(url).hostname === "all.events" && records.length === 1) {
    const visible = $("div")
      .filter(
        (_, e) =>
          !$(e).children().length &&
          /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s*•/.test(text($(e).text())),
      )
      .first();
    const label = text(visible.text()),
      match = label.match(
        /\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}).*\(([A-Z]{2,5})\)\s*$/,
      );
    const clocks = parseTimeRange(label),
      structured = records[0];
    if (/Z$/.test(structured.startLocal ?? "") && (!match || !clocks.startTime))
      throw Object.assign(
        new Error(
          "Known AllEvents UTC markup requires its visible date/time contract",
        ),
        { code: "contract_changed" },
      );
    if (
      match &&
      clocks.startTime &&
      /Z$/.test(structured.startLocal ?? "") &&
      !["UTC", "GMT"].includes(match[4])
    ) {
      const month =
        [
          "jan",
          "feb",
          "mar",
          "apr",
          "may",
          "jun",
          "jul",
          "aug",
          "sep",
          "oct",
          "nov",
          "dec",
        ].indexOf(match[2].toLowerCase()) + 1;
      const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
      const corrected = eventRecord(
        config,
        {
          ...structured,
          id: structured.sourceRecordId,
          startDate: date,
          endDate: structured.endDate,
          startLocal: `${date}T${clocks.startTime}`,
          endLocal:
            clocks.endTime && structured.endDate
              ? `${structured.endDate}T${clocks.endTime}`
              : null,
          timeZone: null,
          timeZoneLabel: match[4],
          timeZoneBasis: "visible source abbreviation; offset unresolved",
          dateTimeBasis: {
            start: "visible event date and clock",
            end: "visible clock and source end date",
          },
          warnings: [
            ...structured.warnings,
            "structured_offset_conflicts_with_visible_zone",
          ],
          raw: { structured: structured.raw, visibleDateTime: label },
        },
        {
          url,
          selector: "event date/time leaf div",
          jsonPath: structured.evidence.jsonPath,
        },
      );
      if (!corrected)
        throw Object.assign(
          new Error(
            "Visible AllEvents date/time contradicts its structured boundaries",
          ),
          { code: "data_quality_error" },
        );
      records[0] = corrected;
    }
  }
  const structuredCount = records.length;
  const add = (input, selector) => {
    const record = eventRecord(
      config,
      {
        title,
        url,
        dateTimeBasis: {
          start: "visible detail date/occurrence",
          end: "visible detail date/occurrence",
        },
        ...input,
      },
      { url, selector },
    );
    if (record) records.push(record);
  };
  if (config.adapter === "nyc-tourism") {
    const summary = $('[class*="BroadwaySummary_textContent"]').first();
    const rawDate = summary
      .find('[class*="BroadwaySummary_detailText"]')
      .map((_, e) => text($(e).text()))
      .get()
      .find((t) => dates(t).startDate);
    const section = $("h3")
      .filter((_, e) => text($(e).text()) === "Location")
      .first()
      .parent();
    const full =
      text(summary.find('a[href*="/maps/dir/"]').first().text()) ||
      text(section.find("p").first().text());
    const address = full?.match(
      /^(.*?),\s*([^,]+),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)$/,
    );
    const map = summary
      .find('a[href*="/maps/dir/Current+Location/"]')
      .first()
      .attr("href");
    const pair = map?.match(/\/([+-]?[\d.]+),([+-]?[\d.]+)(?:[/?#]|$)/);
    add(
      {
        rawDate,
        location: {
          venue: text(section.find('a[href*="/places/"]').first().text()),
          formattedAddress: full,
          streetAddress: address?.[1],
          locality: address?.[2],
          region: address?.[3],
          postalCode: address?.[4],
          basis: "event detail Location section",
        },
        geoCoordinates: pair ? { latitude: pair[1], longitude: pair[2] } : null,
        raw: { date: rawDate, address: full, mapLink: map },
      },
      "[class*=BroadwaySummary_textContent]; Location heading section",
    );
    method = "nyc-tourism-detail";
  } else if (config.adapter === "opencities") {
    const marker = $(".gmap-marker").first(),
      full = text(marker.find(".gmap-address").text());
    const pair = text(marker.find(".gmap-latlong").text()).match(
      /^([+-]?[\d.]+),\s*([+-]?[\d.]+)$/,
    );
    const streetZip = full.match(/^(.*?)\s*,\s*(\d{5}(?:-\d{4})?)$/);
    const location = {
      venue: text(marker.find(".gmap-info h2").text()),
      formattedAddress: full,
      streetAddress: streetZip?.[1],
      postalCode: streetZip?.[2],
      basis: "event detail map marker",
    };
    $(".multi-date-item[data-start-year]").each((_, e) => {
      const c = $(e),
        date = (key) => {
          const parts = ["year", "month", "day"].map((p) =>
            c.attr(`data-${key}-${p}`),
          );
          return parts.every(Boolean)
            ? `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
            : null;
        },
        timestamp = (key) => {
          const d = date(key),
            h = c.attr(`data-${key}-hour`),
            m = c.attr(`data-${key}-mins`);
          return d && h !== undefined && m !== undefined
            ? `${d}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`
            : d;
        };
      add(
        {
          startDate: timestamp("start"),
          endDate: timestamp("end"),
          location,
          geoCoordinates: pair
            ? { latitude: pair[1], longitude: pair[2] }
            : null,
          raw: {
            occurrence: { ...e.attribs },
            address: full,
            coordinates: pair?.[0],
            visibleDate: text(c.text()),
          },
        },
        ".multi-date-item[data-start-year]; .gmap-marker",
      );
    });
    method = "opencities-detail-occurrences";
  } else if (profile === "boston") {
    const root = $(".event-detail-page"),
      rawDate = text(root.find(".date-title").first().text());
    const times = parseTimeRange(
        root.find(".evt-sb-i .detail-item--secondary").first().text(),
      ),
      range = dates(rawDate);
    const address = root.find('[itemprop="address"]').first(),
      prop = (name) =>
        text(address.find(`[itemprop="${name}"]`).first().text());
    add(
      {
        rawDate,
        startLocal:
          times.startTime && range.startDate
            ? `${range.startDate}T${times.startTime}`
            : null,
        endLocal:
          times.endTime && range.endDate
            ? `${range.endDate}T${times.endTime}`
            : null,
        location: {
          streetAddress: prop("streetAddress"),
          locality: prop("addressLocality"),
          region: prop("addressRegion"),
          postalCode: prop("postalCode"),
          country: text(address.find(".country").first().text()),
          basis: "event detail PostalAddress",
        },
        raw: { date: rawDate },
      },
      ".event-detail-page .date-title; .evt-sb-i; [itemprop=address]",
    );
    method = "boston-detail";
  } else if (config.adapter === "chicago-parks") {
    const root = $("article.node--type-event.node--view-mode-full").first(),
      when = root.find(".event--date-time .field__item").first(),
      lines = (when.html() ?? "")
        .split(/<br\s*\/?>/i)
        .map((part) => text(part))
        .filter(Boolean);
    const range = dates(lines[0] ?? ""),
      clocks = parseTimeRange(lines.slice(1).join(" "));
    const multiDay = range.endDate && range.endDate !== range.startDate;
    const warnings = [];
    let startLocal = null,
      endLocal = null;
    if (!multiDay && range.startDate && clocks.startTime) {
      startLocal = `${range.startDate}T${clocks.startTime}`;
      if (clocks.endTime && clocks.endTime >= clocks.startTime)
        endLocal = `${range.startDate}T${clocks.endTime}`;
      else if (clocks.endTime) warnings.push("end_time_requires_date_review");
    } else if (multiDay && clocks.startTime)
      warnings.push("multi_day_clock_semantics_unverified");
    // The page's own "Add to calendar" link restates the occurrence; a
    // disagreement is retained as a warning, never silently corrected.
    const link = root
      .find('a[href*="calendar.google.com/calendar/render"]')
      .first()
      .attr("href");
    const linked = link?.match(/[?&]dates=(\d{8})T(\d{6})\/(\d{8})T(\d{6})/);
    if (linked && startLocal) {
      const iso = (d, t) =>
        `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
      if (iso(linked[1], linked[2]) !== startLocal)
        warnings.push("calendar_link_conflicts_with_visible_datetime");
    }
    const street = text(root.find(".facility .address").first().text()),
      parsedAddress = street.match(
        /^(.*?)\s+(Chicago),\s*(IL)\s+(\d{5}(?:-\d{4})?)$/,
      );
    const categories = text(
      root.find(".field--name-field-event-category").first().text(),
    )
      .replace(/^Categories:\s*/i, "")
      .split(",")
      .map((label) => text(label))
      .filter(Boolean);
    add(
      {
        startDate: range.startDate,
        endDate: multiDay
          ? range.endDate
          : endLocal
            ? range.startDate
            : undefined,
        startLocal: startLocal ?? undefined,
        endLocal: endLocal ?? undefined,
        dateTimeBasis: {
          start: "visible detail date and clock",
          end: endLocal || multiDay ? "visible detail date and clock" : null,
        },
        location: {
          venue: text(root.find(".facility--address > a").first().text()),
          formattedAddress: street,
          streetAddress: parsedAddress?.[1],
          locality: parsedAddress?.[2],
          region: parsedAddress?.[3],
          postalCode: parsedAddress?.[4],
          basis: "event detail facility address",
        },
        categoryTags: categories.map((label) => ({
          label,
          basis: "upstream event category",
        })),
        warnings,
        raw: {
          dateTime: lines,
          fee: text(
            root.find(".field--name-field-event-fee .field__item").text(),
          ),
          ageRange: text(
            root.find(".field--name-field-age-range .field__item").text(),
          ),
        },
      },
      "article.node--type-event .event--date-time; .facility; .field--name-field-event-category",
    );
    method = "chicago-parks-detail";
  } else if (!records.length && config.adapter === "la") {
    const rawDate = text($(".sidebar_event_date > span").first().text());
    add(
      {
        rawDate,
        location: {
          venue: "Los Angeles Convention Center",
          locality: "Los Angeles",
          region: "CA",
          country: "US",
          basis: "single-venue calendar",
        },
        raw: { date: rawDate },
      },
      ".sidebar_event_date > span",
    );
    method = "la-detail";
  }
  let selected = records;
  if (
    ["boston", "opencities"].includes(profile) &&
    records.length > structuredCount
  ) {
    const structured = records.slice(0, structuredCount);
    selected = records.slice(structuredCount).map((record) => {
      const matching = structured.filter(
        (r) =>
          r.startDate === record.startDate &&
          (!r.startLocal ||
            !record.startLocal ||
            r.startLocal.slice(11, 16) === record.startLocal.slice(11, 16)),
      );
      if (matching.length === 1)
        return mergeDetail(matching[0], record) ?? record;
      if (structured.length) {
        record.raw = {
          ...record.raw,
          structuredCandidates: structured.map((r) => ({
            startDate: r.startDate,
            endDate: r.endDate,
            startLocal: r.startLocal,
            endLocal: r.endLocal,
            evidence: r.evidence,
          })),
        };
        record.warnings.push(
          "structured_dates_conflict_with_visible_occurrence",
        );
        record.fieldQuality = fieldQuality(record);
      }
      return record;
    });
  }
  if (!selected.length)
    issues.push({ code: "detail_event_fields_unavailable" });
  if (ld.parseErrors.length)
    issues.push({
      code: "malformed_structured_data",
      count: ld.parseErrors.length,
    });
  const combined = [];
  for (const record of selected) {
    const index = combined.findIndex(
      (r) =>
        canonical(r.url) === canonical(record.url) &&
        r.startDate === record.startDate &&
        r.title === record.title &&
        sameOccurrenceTime(r.startLocal, record.startLocal),
    );
    if (index >= 0)
      combined[index] = mergeDetail(combined[index], record) ?? combined[index];
    else combined.push(record);
  }
  return {
    records: combined,
    nextRequests: [],
    method,
    observedCount: combined.length,
    rejected: 0,
    issues,
    coverage: "detail-only",
    terminal: false,
    discoveryLinks: [],
  };
}
