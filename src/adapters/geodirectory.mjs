import { text, eventRecord, validDate } from "../records.mjs";

// GeoDirectory (WordPress) Events REST API: /wp-json/geodir/v2/events. The
// default query returns upcoming events ordered by start date. Page totals are
// only in the X-WP-Total / X-WP-TotalPages response headers; when the transport
// supplies them they must agree with the pages walked, otherwise a short page
// ends the enumeration.
const contractError = (message) =>
  Object.assign(new Error(message), { code: "contract_changed" });
const clock = (value) =>
  /^\d{1,2}:\d{2}$/.test(value ?? "") ? `${value.padStart(5, "0")}:00` : null;
const isoLocal = (date, time) =>
  validDate(date) && clock(time) ? `${date}T${clock(time)}` : null;

export function parseGeoDirectoryPage(body, url, config, totals) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw contractError("GeoDirectory API returned non-JSON");
  }
  if (!Array.isArray(data))
    throw contractError("Expected a GeoDirectory event array");
  const requestUrl = new URL(url),
    page = Number(requestUrl.searchParams.get("page") ?? 1),
    perPage = Number(requestUrl.searchParams.get("per_page") ?? 10),
    issues = [],
    recurringExpanded = [],
    records = [];
  let rejected = 0;
  for (const event of data) {
    if (
      !event ||
      typeof event.id === "undefined" ||
      !event.title ||
      !event.link ||
      !event.event_dates
    )
      throw contractError("GeoDirectory event identity or dates changed");
    const dates = event.event_dates,
      title = text(event.title.raw ?? event.title.rendered ?? event.title),
      allDay = dates.all_day === true || dates.all_day === "1";
    // Occurrences: a recurring event is expanded into its listed schedules; a
    // single event uses its own date block.
    const occurrences =
      dates.recurring && event.event_schedules?.length
        ? event.event_schedules.map((s) => ({
            key: String(s.schedule_id),
            startDate: s.start_date?.raw,
            endDate: s.end_date?.raw,
            startTime: s.all_day === "1" ? null : s.start_time?.raw,
            endTime: s.all_day === "1" ? null : s.end_time?.raw,
            allDay: s.all_day === "1",
          }))
        : [
            {
              key: "",
              startDate: dates.start_date,
              endDate: dates.end_date,
              startTime: allDay ? null : dates.start_time,
              endTime: allDay ? null : dates.end_time,
              allDay,
            },
          ];
    // Expansion is expected behaviour, not a failure: it is counted (and stops
    // the header total from being compared with occurrence records) but is not
    // a page issue that would hold the run partial.
    if (dates.recurring && event.event_schedules?.length)
      recurringExpanded.push(String(event.id));
    // A recurring item without schedules yields only its master date; the
    // future occurrences were not collected.
    else if (dates.recurring)
      issues.push({
        code: "recurring_series_not_expanded",
        id: String(event.id),
      });
    for (const o of occurrences) {
      const startLocal = isoLocal(o.startDate, o.startTime),
        // A 00:00 end is the API's placeholder for "no end time".
        endLocal =
          startLocal && o.endTime && o.endTime !== "00:00"
            ? isoLocal(o.endDate || o.startDate, o.endTime)
            : null;
      const record = eventRecord(
        config,
        {
          id: o.key ? `${event.id}|${o.key}` : String(event.id),
          title,
          url: event.link,
          startDate: o.startDate,
          endDate: o.endDate || undefined,
          startLocal: startLocal ?? undefined,
          endLocal: endLocal && endLocal >= startLocal ? endLocal : undefined,
          dateTimeBasis: {
            start: startLocal
              ? "source event_dates date and start time"
              : "source event_dates date",
            end: o.endDate ? "source event_dates end date" : null,
          },
          allDay: o.allDay || null,
          location: {
            venue: text(event.venue_name_),
            address: text(event.street),
            locality: text(event.city),
            region: text(event.region),
            country: text(event.country),
            postalCode: text(event.zip),
            basis: "source listing address fields",
          },
          geoCoordinates:
            event.latitude && event.longitude
              ? { latitude: event.latitude, longitude: event.longitude }
              : null,
          categoryTags: (event.post_category ?? []).map((c) => ({
            label: text(c.name),
            slug: c.slug,
            basis: "upstream category",
          })),
          raw: {
            event_dates: dates,
            ticket_url: event.ticket__registration_url || null,
            website: event.website || null,
          },
        },
        { url, jsonPath: `$[id=${event.id}]` },
      );
      if (record)
        records.push({ ...record, validationStatus: "parser-validated" });
      else rejected++;
    }
  }
  const totalPages = totals?.totalPages ?? null,
    terminal = totalPages ? page >= totalPages : data.length < perPage;
  if (totalPages && page > totalPages)
    throw contractError("GeoDirectory page beyond the declared page count");
  const next = new URL(url);
  next.searchParams.set("page", String(page + 1));
  return {
    records,
    nextRequests: terminal
      ? []
      : [{ url: next.href, kind: "api", depth: 0, meta: { pagination: true } }],
    expectedTotal:
      issues.length || rejected || recurringExpanded.length
        ? undefined
        : (totals?.total ?? undefined),
    ...(recurringExpanded.length
      ? { recurringExpanded: recurringExpanded.length }
      : {}),
    terminal,
    coverage: "api-query",
    method: "geodirectory-rest",
    issues: [
      ...issues.slice(0, 1),
      ...(rejected
        ? [{ code: "records_require_parse_review", count: rejected }]
        : []),
    ],
    rejected,
    observedCount: data.length,
    scopeWarning:
      "GeoDirectory default events query (upcoming); recurring events are expanded per listed schedule",
  };
}
