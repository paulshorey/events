import { load } from "cheerio";
import { eventRecord } from "../records.mjs";

// lacity.gov embeds a React calendar (calendarui.lacity.org/src-calendar.js)
// that reads the City's Drupal feed:
//   GET https://api.lacity.org/city_calendar?_format=json&display_id=rest_export
//       &start=YYYY-MM-DD&items_per_page=15&offset=N
// Observed 2026-11-05: items_per_page above 15 returns an empty list, so the
// page size is fixed at the widget's own 15 and paged by offset. A short page
// ends the listing. The feed mixes public meetings (ENS) with community events.
export const LA_PAGE_SIZE = 15;

export function laCityApiUrl(config, asOf, offset = 0) {
  const url = new URL(config.apiEndpoint);
  const params = {
    _format: "json",
    display_id: "rest_export",
    start: asOf,
    items_per_page: String(LA_PAGE_SIZE),
  };
  if (offset) params.offset = String(offset);
  url.search = new URLSearchParams(params);
  return url.href;
}

const decode = (value) =>
  typeof value === "string"
    ? load(`<p>${value}</p>`)("p").text().replace(/\s+/g, " ").trim()
    : "";
// "2026-11-05T08:30:00-0800" -> "2026-11-05T08:30:00-08:00"
const iso = (value) =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d{4}$/.test(String(value ?? ""))
    ? value.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")
    : null;

export function parseLaCityApi(body, url, config) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("LA City calendar API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  if (!Array.isArray(data))
    throw Object.assign(new Error("LA City calendar API is not an array"), {
      code: "contract_changed",
    });
  const issues = [],
    records = [];
  let rejected = 0;
  for (const item of data) {
    const start = iso(item["event-full-date-field-start"] ?? item.start),
      endRaw = iso(item["event-full-date-field-end"]);
    // Meetings repeat the start as the end (duration 0); only a later end is real.
    const end =
      endRaw && start && Date.parse(endRaw) > Date.parse(start)
        ? endRaw
        : undefined;
    const street = [decode(item.street), decode(item.street2)]
      .filter(Boolean)
      .join(", ");
    const place = {
      venue: decode(item.organization) || undefined,
      streetAddress: street || undefined,
      locality: decode(item.city) || undefined,
      region: decode(item.state) || undefined,
      postalCode: decode(item.zipcode) || undefined,
      basis: "upstream address fields",
    };
    const tags = decode(item.eventtypes)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const record =
      item.id && start && item.url
        ? eventRecord(
            config,
            {
              // Recurring events reuse one node id for every occurrence.
              id: `${item.id}|${start}`,
              title: decode(item.rawtitle || item.title),
              url: item.url,
              startDate: start,
              endDate: end,
              location:
                place.venue || place.streetAddress || place.locality
                  ? place
                  : null,
              categoryTags: tags.map((label) => ({
                label,
                basis: "upstream event type",
              })),
              raw: {
                id: item.id,
                externalid: item.externalid,
                department: decode(item.department),
                eventtime: item.eventtime,
                eventdate: item["event-date"],
              },
            },
            { url, selector: "GET /city_calendar" },
          )
        : null;
    record ? records.push(record) : rejected++;
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  const offset = Number(new URL(url).searchParams.get("offset") ?? 0),
    // No total is published, so a short page is not proof of the end: paging
    // continues until an empty page, which is the only terminal response.
    full = data.length > 0,
    nextRequests = [];
  if (full) {
    const next = new URL(url);
    next.searchParams.set("offset", String(offset + LA_PAGE_SIZE));
    nextRequests.push({
      url: next.href,
      kind: "api",
      depth: 0,
      meta: { pagination: true },
    });
  }
  return {
    records: records.map((r) => ({
      ...r,
      validationStatus: "parser-validated",
    })),
    nextRequests,
    terminal: !full,
    coverage: "api-query",
    method: "lacity-api",
    issues,
    rejected,
    observedCount: data.length,
    scopeWarning:
      "City calendar feed from the as-of date; public meetings dominate",
  };
}
