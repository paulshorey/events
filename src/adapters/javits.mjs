import { load } from "cheerio";
import { eventRecord, text } from "../records.mjs";

// Javits Center calendar. The page is a Next.js app: the first month is
// embedded in its server-rendered payload (`initialEvents`) and each other
// month button asks the site's own JSON endpoint for that month. The browser
// transport clicks the buttons; this parser reads either document.
const VENUE = {
  venue: "Jacob K. Javits Convention Center",
  address: "655 W. 34th Street",
  locality: "New York",
  region: "NY",
  postalCode: "10001",
  country: "US",
  basis: "single-venue source (published footer address)",
};

export function jsonValueAt(source, start) {
  const open = source[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0)
      return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON value in page payload");
}

export function rscPayload(html) {
  const chunks = [
    ...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g),
  ];
  return chunks.map((m) => JSON.parse(`"${m[1]}"`)).join("");
}

function fromHtml(html) {
  const payload = rscPayload(html);
  const at = payload.indexOf('"initialEvents":[');
  if (at < 0)
    throw Object.assign(new Error("Javits initial events payload missing"), {
      code: "contract_changed",
    });
  const events = jsonValueAt(payload, payload.indexOf("[", at));
  const hiddenAt = payload.lastIndexOf('"hiddenEventIds":[', at);
  const hidden = hiddenAt >= 0 ? jsonValueAt(payload, payload.indexOf("[", hiddenAt)) : [];
  const $ = load(html);
  const months = $(".month-selector-scroll button")
    .map((_, e) => text($(e).text()))
    .get();
  if (!months.length)
    throw Object.assign(new Error("Javits month selector missing"), {
      code: "pagination_changed",
    });
  return { events, hidden: hidden.map(String), months };
}

export function parseJavitsMonth({ html, url, config, task }) {
  const trimmed = html.trimStart();
  let events,
    hidden,
    months,
    index = task?.meta?.monthIndex ?? 0;
  if (trimmed.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(html);
    } catch {
      throw Object.assign(new Error("Javits month API returned bad JSON"), {
        code: "contract_changed",
      });
    }
    if (!Array.isArray(data?.events))
      throw Object.assign(new Error("Javits month API contract changed"), {
        code: "contract_changed",
      });
    events = data.events;
    hidden = task.meta.hidden ?? [];
    months = task.meta.months;
  } else {
    ({ events, hidden, months } = fromHtml(html));
    index = 0;
  }
  const hiddenSet = new Set(hidden),
    site = new URL(config.url).origin,
    records = [],
    issues = [];
  let rejected = 0,
    excluded = { hidden: 0, internal: 0, blackout: 0, unconfirmed: 0 };
  for (const e of events) {
    if (hiddenSet.has(String(e.uniqueNumber ?? "")) || hiddenSet.has(String(e.id ?? "").replace(/^event-/, ""))) {
      excluded.hidden++;
      continue;
    }
    if (e.isInternal) {
      excluded.internal++;
      continue;
    }
    if (e.isBlackout) {
      excluded.blackout++;
      continue;
    }
    if (e.status !== "Confirmed") {
      excluded.unconfirmed++;
      continue;
    }
    const record = eventRecord(
      config,
      {
        id: `${e.id}|${e.startDate}`,
        title: e.name,
        url: `${site}/calendar#${encodeURIComponent(e.id)}`,
        startDate: e.startDate,
        endDate: e.endDate,
        dateTimeBasis: {
          start: "calendar event startDate (day precision)",
          end: "calendar event endDate (day precision)",
        },
        location: VENUE,
        categoryTags: [e.genreName, e.eventType]
          .filter(Boolean)
          .map((label) => ({
            label: text(label),
            basis: "calendar event genre/type code",
          })),
        raw: {
          id: e.id,
          startDate: e.startDate,
          endDate: e.endDate,
          status: e.status,
          eventType: e.eventType,
          genreName: e.genreName,
          website: e.website ?? null,
        },
      },
      { url, selector: "javits calendar event JSON", eventId: e.id },
    );
    if (record)
      records.push({ ...record, validationStatus: "parser-validated" });
    else rejected++;
  }
  if (rejected) issues.push({ code: "calendar_events_rejected", count: rejected });
  const last = index >= months.length - 1;
  const nextRequests = [];
  if (!last) {
    const next = new URL(config.url);
    next.hash = `events-miner-month=${index + 1}`;
    nextRequests.push({
      url: next.href,
      kind: "listing",
      depth: 0,
      meta: {
        pagination: true,
        monthIndex: index + 1,
        monthLabel: months[index + 1],
        months,
        hidden: [...hiddenSet],
      },
    });
  }
  return {
    records,
    nextRequests,
    terminal: last,
    coverage: "verified-list",
    method: "javits-month-calendar",
    issues,
    rejected,
    observedCount: events.length,
    excluded,
  };
}
