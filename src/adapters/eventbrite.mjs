// Eventbrite search/browse pages (for example /d/nv--las-vegas/all-events/) embed
// their results as `window.__SERVER_DATA__` JSON. Results carry exact local dates,
// clock times, time zone and venue; nothing is inferred from card text.
import { eventRecord } from "../records.mjs";

const MARKER = "window.__SERVER_DATA__ = ";
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
function serverData(html) {
  const marker = html.indexOf(MARKER);
  const start = marker < 0 ? -1 : html.indexOf("{", marker);
  if (start < 0) fail("contract_changed", "Eventbrite server data missing");
  const end = html.indexOf("</script>", start);
  const body = html.slice(start, end < 0 ? undefined : end);
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(body.slice(0, i + 1));
      } catch {
        break;
      }
    }
  }
  return fail("contract_changed", "Eventbrite server data is not valid JSON");
}
const clock = (value) =>
  typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
const date = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export function parseEventbriteSearch({ html, url, config }) {
  const data = serverData(html),
    events = data?.search_data?.events,
    pagination = events?.pagination;
  if (
    !Array.isArray(events?.results) ||
    !Number.isSafeInteger(pagination?.page_number) ||
    !Number.isSafeInteger(pagination?.page_count) ||
    !Number.isSafeInteger(pagination?.page_size)
  )
    fail("contract_changed", "Eventbrite search results contract missing");
  const requested = Number(new URL(url).searchParams.get("page") ?? 1);
  if (pagination.page_number !== requested)
    fail(
      "pagination_changed",
      `Eventbrite requested page ${requested}, received ${pagination.page_number}`,
    );
  const maxPages = config.searchMaxPages ?? 100;
  if (pagination.page_count > maxPages)
    fail("pagination_changed", "Eventbrite page count exceeds safety bound");
  const records = [];
  let rejected = 0;
  for (const e of events.results) {
    const startDate = date(e.start_date),
      endDate = date(e.end_date),
      startTime = clock(e.start_time),
      endTime = clock(e.end_time),
      venue = e.primary_venue,
      address = venue?.address,
      warnings = [];
    if (e.is_cancelled) warnings.push("source_marked_cancelled");
    if (e.is_online_event) warnings.push("virtual_location_present");
    const record = eventRecord(
      config,
      {
        id: String(e.eventbrite_event_id ?? e.id ?? ""),
        title: e.name,
        url: e.url,
        startDate: startDate
          ? startTime
            ? `${startDate}T${startTime}`
            : startDate
          : undefined,
        endDate: endDate
          ? endTime
            ? `${endDate}T${endTime}`
            : endDate
          : undefined,
        timeZone: e.timezone || undefined,
        dateTimeBasis: {
          start: startTime
            ? "upstream start_date and start_time"
            : "upstream start_date",
          end: endDate
            ? endTime
              ? "upstream end_date and end_time"
              : "upstream end_date"
            : null,
        },
        location: venue
          ? {
              venue: venue.name,
              streetAddress: address?.address_1,
              locality: address?.city,
              region: address?.region,
              country: address?.country,
              postalCode: address?.postal_code,
              basis: "upstream search result venue",
            }
          : undefined,
        geoCoordinates: address
          ? { latitude: address.latitude, longitude: address.longitude }
          : undefined,
        categoryTags: (e.tags ?? [])
          .filter((t) =>
            /^Eventbrite(?:Category|SubCategory|Format)$/.test(t.prefix),
          )
          .map((t) => ({
            label: t.display_name,
            slug: t.tag,
            basis: "upstream tag",
          })),
        warnings,
        raw: e,
      },
      { url, selector: "window.__SERVER_DATA__.search_data.events.results" },
    );
    if (record && e.eventbrite_event_id) records.push(record);
    else rejected++;
  }
  const current = pagination.page_number,
    last = pagination.page_count,
    next = new URL(url);
  next.searchParams.set("page", String(current + 1));
  // Eventbrite serves at most page_count pages for a larger object_count.
  const capped =
    pagination.page_count * pagination.page_size <
    (pagination.object_count ?? 0);
  return {
    records,
    observedCount: events.results.length,
    rejected,
    terminal: current >= last,
    // A capped search view is not the whole catalogue.
    coverage: capped ? "unverified" : "verified-list",
    nextRequests:
      current >= last
        ? []
        : [
            {
              url: next.href,
              kind: "listing",
              depth: 0,
              meta: { pagination: true },
            },
          ],
    capped,
    objectCount: pagination.object_count ?? null,
  };
}
