import { text, eventRecord, validDate } from "../records.mjs";

// eventfinder.site search API (the same POST /api/getEvents the public site
// calls). The catalogue is paged newest-first by StartDate with
// {filters:{startDateFrom}, page, limit<=250}. Its time-of-day values are not
// dependable (some are UTC clocks inside local calendars), so only the calendar
// day is recorded; the source timestamps stay in `raw`.
const contractError = (message) =>
  Object.assign(new Error(message), { code: "contract_changed" });
const day = (value) => {
  const part = typeof value === "string" ? value.slice(0, 10) : "";
  return validDate(part) ? part : null;
};
const nonEmpty = (value) => text(value) || undefined;

export function parseEventfinderPage(body, url, config, task) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw contractError("Eventfinder API returned non-JSON");
  }
  const pagination = data?.pagination;
  if (
    !Array.isArray(data?.events) ||
    !Number.isInteger(pagination?.page) ||
    !Number.isInteger(pagination?.totalPages) ||
    !Number.isInteger(pagination?.totalItems)
  )
    throw contractError("Expected Eventfinder events[] and pagination");
  const requested = Number(task?.meta?.request?.body?.page ?? 1);
  if (pagination.page !== requested)
    throw Object.assign(
      new Error(
        `Eventfinder returned page ${pagination.page} for requested page ${requested}`,
      ),
      { code: "pagination_changed" },
    );
  const origin = new URL(config.apiEndpoint ?? config.url).origin,
    records = [];
  let rejected = 0;
  for (const event of data.events) {
    if (!event || event.eventId == null)
      throw contractError("Eventfinder event identity changed");
    // A blank title is a source data defect: reject the row, keep the page.
    if (!text(event.title)) {
      rejected++;
      continue;
    }
    const page = new URL(
      event.canonicalUrl || `/event/${event.eventId}`,
      origin,
    ).href;
    const place = event.location ?? event.venue?.location ?? {},
      venueName = nonEmpty(event.venue?.name),
      coordinates = event.coordinates,
      fromVenue = coordinates?.source === "venue" && !!event.venue;
    const locationWarnings = [];
    // The event's own city disagreeing with the venue address is surfaced.
    if (
      fromVenue &&
      nonEmpty(place.city) &&
      nonEmpty(event.venue?.formattedAddress) &&
      !event.venue.formattedAddress
        .toLowerCase()
        .includes(String(place.city).toLowerCase())
    )
      locationWarnings.push("venue_and_event_location_disagree");
    const record = eventRecord(
      config,
      {
        id: String(event.eventId),
        title: event.title,
        url: page,
        startDate: day(event.startDate),
        endDate: day(event.endDate) ?? undefined,
        dateTimeBasis: {
          start: "source startDate calendar day",
          end: day(event.endDate) ? "source endDate calendar day" : null,
        },
        // One object is authoritative, as named by coordinates.source: the
        // venue (name, address) or the event location (city fields). Fields
        // from the other object are never mixed in.
        location: event.isVirtual
          ? null
          : fromVenue
            ? {
                venue:
                  venueName && venueName.toUpperCase() !== "VIRTUAL"
                    ? venueName
                    : undefined,
                formattedAddress: nonEmpty(event.venue?.formattedAddress),
                postalCode: nonEmpty(event.venue?.postalCode),
                basis: "source venue fields (coordinates.source = venue)",
              }
            : {
                formattedAddress: nonEmpty(place.formattedAddress),
                locality: nonEmpty(place.city ?? event.city),
                region: nonEmpty(place.state ?? event.state),
                country: nonEmpty(place.country ?? event.country),
                postalCode: nonEmpty(place.postalCode),
                basis: "source event location fields",
              },
        geoCoordinates:
          !event.isVirtual &&
          coordinates?.latitude != null &&
          coordinates?.longitude != null
            ? {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
              }
            : null,
        categoryTags: [event.type, event.primaryVibe]
          .map((label) => nonEmpty(label))
          .filter(Boolean)
          .map((label) => ({ label, basis: "upstream classification" })),
        warnings: event.isVirtual
          ? ["virtual_location_present"]
          : locationWarnings,
        raw: {
          // A venue name is kept here, not claimed, when the event location
          // is the authoritative object.
          venueName: fromVenue ? undefined : (venueName ?? undefined),
          startDate: event.startDate,
          endDate: event.endDate,
          isVirtual: event.isVirtual,
          timeOfDay: event.timeOfDay ?? null,
          organizer: event.entity?.name ?? null,
          registrationUrl: event.registrationUrl ?? null,
          eventUrl: event.eventUrl ?? null,
          eventSources: event.eventSources ?? null,
        },
      },
      { url, jsonPath: `$.events[eventId=${event.eventId}]` },
    );
    if (record)
      records.push({ ...record, validationStatus: "parser-validated" });
    else rejected++;
  }
  const last = pagination.page >= pagination.totalPages,
    next = new URL(url);
  next.searchParams.set("page", String(pagination.page + 1));
  const request = task?.meta?.request;
  // Each page must hold the requested limit, and the final page the remainder
  // of totalItems; a short response is not a complete page.
  const limit = Number(request?.body?.limit);
  const expectedOnPage = Number.isInteger(limit)
    ? last
      ? pagination.totalItems - (pagination.totalPages - 1) * limit
      : limit
    : null;
  const pageIssues =
    expectedOnPage != null && data.events.length !== expectedOnPage
      ? [
          {
            code: "page_result_count_mismatch",
            expected: expectedOnPage,
            received: data.events.length,
          },
        ]
      : [];
  return {
    records,
    nextRequests:
      last || !request
        ? []
        : [
            {
              url: next.href,
              kind: "api",
              depth: 0,
              meta: {
                pagination: true,
                request: {
                  ...request,
                  body: { ...request.body, page: pagination.page + 1 },
                },
              },
            },
          ],
    // The catalogue grows while it is read, so no fixed total is asserted.
    terminal: last,
    coverage: "api-query",
    method: "eventfinder-search",
    issues: [
      ...pageIssues,
      ...(rejected
        ? [{ code: "records_require_parse_review", count: rejected }]
        : []),
    ],
    rejected,
    observedCount: data.events.length,
    scopeWarning:
      "startDateFrom query of the site search API; events that began earlier and are still running are outside it, and the catalogue changes while paging",
  };
}
