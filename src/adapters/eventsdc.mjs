import { eventRecord } from "../records.mjs";

// Events DC (eventsdc.com) renders /events with a React calendar that reads
// GET /api/events?field_end_date_value=START&field_start_date_value=END
// (observed in the page bundle on 2026-11-05). The two parameters bound an
// overlap window: events ending on/after START and starting on/before END.
// Timestamps are unzoned wall-clock values; the site displays them as-is.
const WINDOW_YEARS = 4;

export function eventsDcApiUrl(config, asOf) {
  const [year, month, day] = asOf.split("-").map(Number);
  const url = new URL(config.apiEndpoint);
  url.search = new URLSearchParams({
    field_end_date_value: `${asOf} 0:0:0`,
    field_start_date_value: `${year + WINDOW_YEARS}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 23:59:59`,
  });
  return url.href;
}

export function parseEventsDcApi(body, url, config) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Events DC API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  if (!Array.isArray(data))
    throw Object.assign(new Error("Events DC API is not an array"), {
      code: "contract_changed",
    });
  const venues = new Map(
      (config.venueOptions ?? []).map((v) => [String(v.id), v.name]),
    ),
    types = new Map(
      (config.eventTypeOptions ?? []).map((v) => [String(v.id), v.name]),
    );
  const issues = [],
    records = [];
  let rejected = 0;
  for (const item of data) {
    const venueIds = [].concat(item.field_venue ?? []).map(String);
    const venueNames = venueIds.map((id) => venues.get(id)).filter(Boolean);
    if (venueIds.length > venueNames.length)
      issues.push({ code: "unknown_venue_id", ids: venueIds });
    const type = item.field_event_type
      ? types.get(String(item.field_event_type))
      : null;
    const record = eventRecord(
      config,
      {
        id: String(item.nid),
        title: item.title,
        url: `/node/${encodeURIComponent(String(item.nid))}`,
        startDate: item.field_start_date,
        endDate: item.field_end_date,
        location: venueNames.length
          ? { venue: venueNames.join("; "), basis: "upstream venue id" }
          : null,
        categoryTags: type
          ? [{ label: type, basis: "upstream event type id" }]
          : [],
        // 23:59 end stamps are a common day-boundary convention; the API does
        // not say whether it is a real closing time, so it is only flagged.
        warnings: /T23:59/.test(String(item.field_end_date))
          ? ["end_time_may_be_day_boundary"]
          : [],
        raw: item,
      },
      { url, selector: "GET /api/events" },
    );
    record ? records.push(record) : rejected++;
  }
  if (rejected) issues.push({ code: "records_require_parse_review", count: rejected });
  return {
    records: records.map((r) => ({ ...r, validationStatus: "parser-validated" })),
    nextRequests: [],
    expectedTotal: data.length,
    terminal: true,
    coverage: "api-query",
    method: "eventsdc-api",
    issues,
    rejected,
    observedCount: data.length,
    scopeWarning: `Overlap window ${WINDOW_YEARS} years from the as-of date`,
  };
}
