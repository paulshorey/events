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
      coordinates = event.coordinates;
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
        location: event.isVirtual
          ? null
          : {
              venue:
                venueName && venueName.toUpperCase() !== "VIRTUAL"
                  ? venueName
                  : undefined,
              formattedAddress: nonEmpty(
                event.venue?.formattedAddress ?? place.formattedAddress,
              ),
              locality: nonEmpty(event.city ?? place.city),
              region: nonEmpty(event.state ?? place.state),
              country: nonEmpty(event.country ?? place.country),
              postalCode: nonEmpty(event.venue?.postalCode ?? place.postalCode),
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
        warnings: event.isVirtual ? ["virtual_location_present"] : [],
        raw: {
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
    issues: rejected
      ? [{ code: "records_require_parse_review", count: rejected }]
      : [],
    rejected,
    observedCount: data.events.length,
    scopeWarning:
      "startDateFrom query of the site search API; events that began earlier and are still running are outside it, and the catalogue changes while paging",
  };
}
