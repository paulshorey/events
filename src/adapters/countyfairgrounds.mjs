import { text, eventRecord } from "../records.mjs";

// countyfairgrounds.net renders each state page from one public JSON request,
// /ajax/ajax_state.php?state=XX&eventtype=all (see js/state_test.js). Each
// response is the complete upcoming list for that state; there is no paging and
// no declared total, so the collection is the fixed set of state entrypoints.
const contractError = (message) =>
  Object.assign(new Error(message), { code: "contract_changed" });
const nonEmpty = (value) => {
  const cleaned = text(value);
  return cleaned && cleaned.toLowerCase() !== "null" ? cleaned : "";
};

export function parseCountyfairgroundsState(body, url, config) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw contractError("Countyfairgrounds state endpoint returned non-JSON");
  }
  if (!Array.isArray(data))
    throw contractError("Expected a Countyfairgrounds event array");
  const request = new URL(url),
    state = (request.searchParams.get("state") ?? "").toUpperCase(),
    records = [],
    issues = [];
  let rejected = 0;
  if (!/^[A-Z]{2}$/.test(state))
    throw contractError("Countyfairgrounds state parameter missing");
  for (const event of data) {
    if (
      !event ||
      event.EventNum == null ||
      !event.EventName ||
      !event.StartDate
    )
      throw contractError("Countyfairgrounds event identity or dates changed");
    const page = new URL(
      `/state.php?state=${encodeURIComponent(state)}#event-${event.EventNum}`,
      config.url,
    ).href;
    const record = eventRecord(
      config,
      {
        id: String(event.EventNum),
        title: event.EventName,
        url: page,
        startDate: event.StartDate,
        endDate: event.EndDate || undefined,
        dateTimeBasis: {
          start: "source StartDate",
          end: event.EndDate ? "source EndDate" : null,
        },
        location: {
          formattedAddress: nonEmpty(event.LocationStreet1),
          locality: nonEmpty(event.LocationCity),
          region: nonEmpty(event.LocationState) || state,
          country: "US",
          basis: "source state listing fields",
        },
        categoryTags: [event.eventType, event.eventType2, event.eventType3]
          .map(nonEmpty)
          .filter(Boolean)
          .map((label) => ({ label, basis: "upstream event type" })),
        raw: {
          eventHours: nonEmpty(event.EventHours) || null,
          county: nonEmpty(event.LocationCounty) || null,
          website: nonEmpty(event.WebSite) || null,
          theme: nonEmpty(event.Theme) || null,
          description: nonEmpty(event.Descriptionsmall) || null,
        },
      },
      { url, jsonPath: `$[EventNum=${event.EventNum}]` },
    );
    if (record)
      records.push({ ...record, validationStatus: "parser-validated" });
    else rejected++;
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  return {
    records,
    nextRequests: [],
    terminal: true,
    coverage: "api-query",
    method: "countyfairgrounds-state-json",
    issues,
    rejected,
    observedCount: data.length,
    scopeWarning:
      "One state's upcoming list as returned by the site's own state page endpoint",
  };
}
