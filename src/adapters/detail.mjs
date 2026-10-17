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
import { mergeDetail, fieldQuality } from "../event-fields.mjs";

const canonical = (value) => {
  const u = new URL(value);
  u.hash = "";
  return u.href.replace(/\/$/, "");
};
export function parseDetail({ html, url, config }) {
  const $ = load(html),
    ld = jsonLdEvents(html),
    records = [],
    issues = [];
  const title = text($("main h1,h1").first().text());
  for (const { event, path } of ld.events) {
    const own = safeUrl(event.url, url) ?? safeUrl(event["@id"], url);
    // On a detail page, an Event without a URL can use the page's own identity
    // only when it is the sole Event and agrees with the main heading.
    const fallback =
      !own &&
      ld.events.length === 1 &&
      text(event.name).toLowerCase() === title.toLowerCase();
    if (!fallback && (!own || canonical(own) !== canonical(url))) continue;
    const record = recordFromJsonLd(
      config,
      fallback ? { ...event, url } : event,
      { url, jsonPath: path },
      ld.references,
    );
    if (record) records.push(record);
  }
  let method = "detail-jsonld";
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
      if (corrected) records[0] = corrected;
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
  } else if (config.adapter === "boston") {
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
    ["boston", "opencities"].includes(config.adapter) &&
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
        r.title === record.title,
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
