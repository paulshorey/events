import { eventRecord } from "../records.mjs";

// sf.gov calendars are rendered by a Next.js app from
// GET https://api.sf.gov/api/related-events/?list=upcoming&locale=en&page=N&groupby=date
// (the page's own `baseUrl` prop, observed 2026-11-05). The response is
// { total, events: [{ year, month, day, events: [...] }] }; pages hold about ten
// events and the first page past the end is empty. The citywide list is a
// superset of the Mayor's calendar route; meetings are included by the source.
const SITE = "https://www.sf.gov";

const clean = (value) => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s || null;
};

function places(item) {
  const out = [];
  for (const block of [
    ...(item.location ?? []),
    ...(item.meeting_location ?? []),
  ]) {
    if (block.type === "address" && block.value) {
      const v = block.value;
      out.push({
        venue: clean(v.location_name) ?? clean(v.address_title),
        streetAddress: [clean(v.line1), clean(v.line2)]
          .filter(Boolean)
          .join(", "),
        locality: clean(v.city),
        region: clean(v.state),
        postalCode: clean(v.zip),
        basis: "upstream address block",
      });
    } else if (block.type === "online") out.push({ "@type": "VirtualLocation" });
  }
  return out;
}

export function parseSfGovApi(body, url, config) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("sf.gov API returned non-JSON"), {
      code: "contract_changed",
    });
  }
  if (
    !data ||
    !Number.isInteger(data.total) ||
    !Array.isArray(data.events) ||
    data.events.some((g) => !Array.isArray(g.events))
  )
    throw Object.assign(new Error("sf.gov API contract changed"), {
      code: "contract_changed",
    });
  const issues = [],
    records = [];
  let observed = 0,
    rejected = 0;
  for (const group of data.events)
    for (const item of group.events) {
      observed++;
      const slug = item.meta?.slug;
      const when = (item.date_time ?? []).find((d) => d.type === "date_time");
      const v = when?.value;
      if (!slug || !v?.start_date) {
        rejected++;
        continue;
      }
      const allDay = v.is_all_day === true;
      const hasEnd = v.include_end_date_time === "yes" && v.end_date;
      // The API's top-level end_datetime is padded to 23:59:59 when the source
      // supplies no end, so it is used only for its UTC offset.
      const offset = (value) => String(value ?? "").match(/[+-]\d\d:\d\d$|Z$/)?.[0];
      const startOffset = offset(item.start_datetime),
        endOffset = offset(item.end_datetime);
      const start = allDay
          ? v.start_date
          : v.start_time && startOffset
            ? `${v.start_date}T${v.start_time}${startOffset}`
            : null,
        end = !hasEnd
          ? undefined
          : allDay
            ? v.end_date
            : v.end_time && endOffset
              ? `${v.end_date}T${v.end_time}${endOffset}`
              : undefined;
      if (!start) {
        rejected++;
        continue;
      }
      // Observed upstream data error: an end dated months before the start. The
      // end is omitted (not corrected) and flagged; the event itself is kept.
      const endBeforeStart =
        end !== undefined && String(end).slice(0, 10) < v.start_date;
      const kind = String(item.meta?.type ?? "").replace(/^sf\./, "");
      const record = eventRecord(
        config,
        {
          id: `${item.id}|${v.start_date}`,
          title: item.title,
          url: `${SITE}/${slug}/`,
          startDate: start,
          endDate: endBeforeStart ? undefined : end,
          allDay: allDay || null,
          location: places(item),
          categoryTags: kind
            ? [{ label: kind, basis: "upstream content type" }]
            : [],
          warnings: [
            ...(item.cancelled ? ["source_marked_cancelled"] : []),
            ...(endBeforeStart ? ["source_end_before_start_omitted"] : []),
          ],
          raw: {
            id: item.id,
            type: item.meta?.type,
            agency: item.primary_agency?.title,
            cancelled: item.cancelled,
            date_time: v,
          },
        },
        { url, selector: "GET /api/related-events" },
      );
      record ? records.push(record) : rejected++;
    }
  const page = Number(new URL(url).searchParams.get("page") ?? 1),
    // The page size is not published; it was ten on every page observed. The run
    // reconciles the final record count against `total`, so a wrong size fails.
    pageSize = config.apiPageSize ?? 10,
    terminal = observed === 0 || page * pageSize >= data.total,
    nextRequests = [];
  if (!terminal) {
    const next = new URL(url);
    next.searchParams.set("page", String(page + 1));
    nextRequests.push({
      url: next.href,
      kind: "api",
      depth: 0,
      meta: { pagination: true },
    });
  }
  if (rejected) issues.push({ code: "records_require_parse_review", count: rejected });
  return {
    records: records.map((r) => ({ ...r, validationStatus: "parser-validated" })),
    nextRequests,
    expectedTotal: data.total,
    terminal,
    coverage: "api-query",
    method: "sfgov-api",
    issues,
    rejected,
    observedCount: observed,
    scopeWarning: "Citywide list=upcoming query; includes government meetings",
  };
}
