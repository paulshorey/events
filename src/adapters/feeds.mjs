// Documented public machine feeds that are not The Events Calendar REST API.
// Each parser is deterministic and conservative: it reads only fields the
// publisher supplies, keeps unknown fields unknown, and never expands
// recurrence rules it has not been asked to understand.
import { createHash } from "node:crypto";
import { eventRecord, text, validDate } from "../records.mjs";

const contractChanged = (message) =>
  Object.assign(new Error(message), { code: "contract_changed" });
const sha = (value) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// -- Localist-style "Live" calendars (events.uchicago.edu) ------------------
// https://events.uchicago.edu/live/json/events returns one entry per
// occurrence with explicit local ISO timestamps and an IANA time zone.
export function parseLiveJson(body, url, config) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw contractChanged("Live calendar API returned non-JSON");
  }
  const meta = data?.meta;
  if (
    !meta ||
    !Array.isArray(data.data) ||
    !Number.isInteger(meta.total_results) ||
    !Number.isInteger(meta.total_pages) ||
    !Number.isInteger(meta.page)
  )
    throw contractChanged("Live calendar API envelope changed");
  const records = [],
    issues = [];
  let rejected = 0;
  for (const e of data.data) {
    const startIso = typeof e.date_iso === "string" ? e.date_iso : null,
      endIso = typeof e.date2_iso === "string" ? e.date2_iso : null;
    const allDay = e.is_all_day === 1 || e.is_all_day === true;
    const startDate = startIso?.slice(0, 10);
    const endDate = endIso?.slice(0, 10);
    const tags = [
      ...(e.event_types ?? []).map((label) => ({
        label,
        basis: "upstream event type",
      })),
      ...(e.tags ?? []).map((label) => ({ label, basis: "upstream tag" })),
    ];
    const online = e.is_online ? (e.online_type ?? "online") : null;
    const record = eventRecord(
      config,
      {
        id: `${e.id}|${startIso}`,
        title: e.title,
        url: e.url,
        // All-day entries carry midnight placeholders; keep them date-only.
        startDate: allDay ? startDate : startIso,
        endDate: allDay ? (endDate ?? undefined) : (endIso ?? undefined),
        allDay: allDay ? true : null,
        timeZone: e.timezone ?? undefined,
        timeZoneBasis: e.timezone ? "upstream timezone field" : undefined,
        dateTimeBasis: {
          start: allDay ? "upstream all-day date" : "upstream date_iso",
          end: endIso ? "upstream date2_iso" : null,
        },
        location: e.location
          ? {
              venue: e.location_title ?? undefined,
              formattedAddress: e.location,
              latitude: e.location_latitude ?? undefined,
              longitude: e.location_longitude ?? undefined,
              basis: "upstream location field",
            }
          : undefined,
        categoryTags: tags,
        warnings: [
          ...(e.is_canceled ? ["source_marks_event_canceled"] : []),
          ...(online ? ["online_or_hybrid_event"] : []),
          ...(e.repeats ? ["recurring_series_occurrence"] : []),
        ],
        raw: {
          id: e.id,
          date: e.date,
          dateTime: e.date_time,
          repeats: e.repeats ?? null,
          cost: e.cost ?? null,
          audience: e.event_types_audience ?? null,
          campus: e.event_types_campus ?? null,
          onlineType: online,
        },
      },
      { url, jsonPath: `data[${e.id}]` },
    );
    if (record) records.push(record);
    else rejected++;
  }
  if (rejected) issues.push({ code: "records_require_parse_review", count: rejected });
  const next = data.links?.next ? new URL(data.links.next, url) : null;
  const sameOrigin = next && next.origin === new URL(url).origin;
  if (next && !sameOrigin) throw contractChanged("Live calendar next link left the publisher origin");
  const nextRequests =
    meta.page < meta.total_pages && next
      ? [{ url: next.href, kind: "api", depth: 0, meta: { pagination: true } }]
      : [];
  if (meta.page < meta.total_pages && !next)
    throw contractChanged("Live calendar next link missing before the last page");
  return {
    records,
    nextRequests,
    expectedTotal: meta.total_results,
    terminal: meta.page >= meta.total_pages,
    coverage: "api-query",
    method: "live-calendar-json",
    issues,
    rejected,
    observedCount: data.data.length,
    scopeWarning:
      "The publisher's default upcoming window; earlier-starting ongoing series are outside this query",
  };
}

// -- iCalendar (RFC 5545) published calendars (Houston City Outlook feed) -----
function unfold(body) {
  return body.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}
const unescapeText = (value) =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1");
function parseLine(line) {
  const colon = (() => {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ":" && !quoted) return i;
    }
    return -1;
  })();
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(";");
  return {
    name: name.toUpperCase(),
    params: Object.fromEntries(
      params.map((p) => {
        const [k, ...v] = p.split("=");
        return [k.toUpperCase(), v.join("=").replace(/^"|"$/g, "")];
      }),
    ),
    value: line.slice(colon + 1),
  };
}
// Windows zone names used by Microsoft Exchange to IANA identifiers.
const WINDOWS_ZONES = {
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
};
function icsTime(prop, zoneOf) {
  if (!prop) return null;
  const value = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    const date = m && `${m[1]}-${m[2]}-${m[3]}`;
    return date && validDate(date) ? { date } : null;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!validDate(date) || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  const local = `${date}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === "Z") return { date, instant: `${local}Z` };
  return { date, local, zone: zoneOf(prop.params.TZID) };
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function parseIcs(body, url, config) {
  if (!/^BEGIN:VCALENDAR/m.test(body))
    throw contractChanged("iCalendar feed envelope missing");
  const events = [];
  let current = null;
  for (const line of unfold(body)) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const p = parseLine(line);
      if (p) current.push(p);
    }
  }
  const records = [],
    issues = [];
  const excluded = { past: 0 };
  let rejected = 0,
    unmapped = 0;
  const examples = [];
  const seen = new Set();
  const get = (props, name) => props.find((p) => p.name === name);
  for (const props of events) {
    const uid = get(props, "UID")?.value,
      summary = get(props, "SUMMARY")?.value,
      startProp = get(props, "DTSTART"),
      endProp = get(props, "DTEND"),
      zones = {};
    const zoneOf = (tzid) => {
      if (!tzid) return null;
      if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
      if (/^[A-Za-z_]+\/[A-Za-z_]+/.test(tzid)) return tzid;
      zones.unknown = tzid;
      return null;
    };
    const start = icsTime(startProp, zoneOf),
      end = icsTime(endProp, zoneOf);
    const allDay = Boolean(start?.date && !start.local);
    let endDate = null,
      endLocal = null;
    if (end?.date) {
      if (allDay) endDate = addDays(end.date, -1); // DTEND is exclusive for dates
      else {
        endDate = end.date;
        endLocal = end.local ?? null;
      }
    }
    if (allDay && endDate && endDate < start.date) endDate = start.date;
    // Events that ended before the as-of date are not upcoming observations.
    const cutoff = config.asOf;
    if (start?.date && cutoff && (endDate ?? start.date) < cutoff) {
      excluded.past++;
      continue;
    }
    if (!uid || !summary || !start || zones.unknown || start.instant) {
      // Floating/UTC instants without a venue zone, or unknown TZIDs, are not
      // converted by guesswork.
      if (!zones.unknown && !start?.instant) {
        rejected++;
        examples.push({ title: summary?.slice(0, 60), dtstart: startProp?.value });
      } else unmapped++;
      continue;
    }
    const allDayFlag = get(props, "X-MICROSOFT-CDO-ALLDAYEVENT")?.value;
    if (get(props, "RRULE"))
      issues.push({ code: "recurrence_rule_not_expanded", uid: sha(uid) });
    const key = `${uid}|${startProp.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const locationRaw = get(props, "LOCATION")?.value;
    const loc = locationRaw ? unescapeText(locationRaw) : "";
    const withoutMap = loc.replace(/\s+-{1,2}\s+https?:\/\/\S+\s*$/, "").trim();
    const mapUrl = loc.match(/\s-{1,2}\s+(https?:\/\/\S+)\s*$/)?.[1];
    const parts = withoutMap.split(/,\s*/);
    const description = get(props, "DESCRIPTION")?.value;
    const status = get(props, "STATUS")?.value;
    const record = eventRecord(
      config,
      {
        id: key,
        title: unescapeText(summary),
        // The feed has no per-event page; the fragment keeps identity stable
        // on the city's published events page.
        url: `${config.url.replace(/#.*$/, "")}#ics-event=${sha(uid)}`,
        startDate: start.date,
        endDate: endDate ?? undefined,
        startLocal: allDay ? undefined : start.local,
        endLocal: allDay ? undefined : (endLocal ?? undefined),
        allDay: allDay ? true : allDayFlag === "FALSE" ? false : null,
        timeZone: start.zone ?? undefined,
        timeZoneLabel: startProp.params.TZID,
        timeZoneBasis: start.zone ? "iCalendar TZID mapped to IANA zone" : undefined,
        dateTimeBasis: {
          start: allDay ? "iCalendar DATE value" : "iCalendar DTSTART with TZID",
          end: endDate ? "iCalendar DTEND" : null,
        },
        location: withoutMap
          ? {
              venue: parts[0],
              formattedAddress: withoutMap,
              basis: "iCalendar LOCATION text",
            }
          : undefined,
        warnings: [
          ...(status && /^CANCEL/i.test(status) ? ["source_marks_event_canceled"] : []),
        ],
        raw: {
          uid,
          dtstart: startProp.value,
          dtend: endProp?.value ?? null,
          status: status ?? null,
          mapUrl: mapUrl ?? null,
          description: description ? unescapeText(description).slice(0, 2000) : null,
        },
      },
      { url, jsonPath: `VEVENT[${sha(uid)}]` },
    );
    if (record) records.push(record);
    else {
      rejected++;
      examples.push({ title: summary?.slice(0, 60), dtstart: startProp.value, dtend: endProp?.value });
    }
  }
  if (rejected) issues.push({ code: "records_require_parse_review", count: rejected, examples: examples.slice(0, 5) });
  if (unmapped) issues.push({ code: "events_with_unmapped_time_zone", count: unmapped });
  return {
    records,
    nextRequests: [],
    // One document, no pagination: terminal when it parses without issues.
    terminal: true,
    coverage: "api-query",
    method: "icalendar-feed",
    issues,
    rejected,
    observedCount: events.length,
    excluded: excluded.past ? { pastEvents: excluded.past } : undefined,
    scopeWarning:
      "The published calendar document as served; it is a curated selection, not every Houston event",
  };
}

// -- XML sitemap of event pages (houston.com) -------------------------------
export function parseEventSitemap(body, url, config) {
  if (!/<urlset[\s>]/.test(body))
    throw contractChanged("Sitemap urlset envelope missing");
  const pattern = new RegExp(config.detailPattern);
  const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    text(m[1]),
  );
  const origin = new URL(url).origin;
  const urls = [
    ...new Set(
      locs.filter((loc) => {
        try {
          const u = new URL(loc);
          return (
            u.origin === origin &&
            pattern.test(u.pathname) &&
            u.pathname.replace(/\/+$/, "") !== "/events"
          );
        } catch {
          return false;
        }
      }),
    ),
  ];
  return {
    records: [],
    nextRequests: urls.map((u) => ({
      url: u,
      kind: "detail",
      depth: 1,
      meta: { discoveredOn: url, sitemap: true },
    })),
    terminal: false,
    // A sitemap lists published pages; it does not prove a complete calendar.
    coverage: "discovery",
    method: "event-sitemap",
    issues: [],
    rejected: 0,
    observedCount: urls.length,
  };
}

export const feedParsers = {
  "live-json": parseLiveJson,
  ics: parseIcs,
  sitemap: parseEventSitemap,
};
