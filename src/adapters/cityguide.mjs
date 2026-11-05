import { load } from "cheerio";
import { eventRecord, text, validDate } from "../records.mjs";

// City Guide NY category listing. Cards show "Saturday Nov 07 - Sunday Nov 08
// | 1 pm" without a year; each card link ends with the event's ISO start and
// end dates (`/event/slug-2026-11-07-2026-11-08`). The URL dates are accepted
// only when the card's own weekday and month/day labels agree with them, so a
// stale or malformed link is flagged instead of trusted.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const label = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    month: MONTHS[d.getUTCMonth()],
    day: d.getUTCDate(),
  };
};
// "Saturday Nov 07" / "Sunday Nov 08"
const parseLabel = (value) => {
  const m = String(value ?? "").match(
    /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\.?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i,
  );
  return m
    ? {
        weekday: m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase(),
        month: m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase(),
        day: Number(m[3]),
      }
    : null;
};
const agrees = (iso, parsed) => {
  if (!parsed || !validDate(iso)) return false;
  const l = label(iso);
  return (
    l.weekday === parsed.weekday &&
    l.month === parsed.month &&
    l.day === parsed.day
  );
};
function clock(value) {
  const m = String(value ?? "")
    .trim()
    .match(
      /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?(?:\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?)?$/i,
    );
  if (!m) return null;
  const to24 = (h, min, ap) => {
    if (Number(h) < 1 || Number(h) > 12 || Number(min ?? 0) > 59) return null;
    return `${String((Number(h) % 12) + (ap.toLowerCase() === "p" ? 12 : 0)).padStart(2, "0")}:${min ?? "00"}`;
  };
  const start = to24(m[1], m[2], m[3]),
    end = m[4] ? to24(m[4], m[5], m[6]) : null;
  return start ? { start, end: end && end > start ? end : null } : null;
}

export function parseCityGuide({ html, url, config }) {
  const $ = load(html),
    records = [],
    issues = [],
    cards = $("a.flex[href^='/event/']");
  const stated = Number(
    text($("body").text()).match(/\b(\d+)\s+Events\b/)?.[1],
  );
  if (!cards.length)
    throw Object.assign(new Error("City Guide event cards missing"), {
      code: "contract_changed",
    });
  let rejected = 0,
    past = 0;
  const conflicts = [];
  cards.each((_, a) => {
    const c = $(a),
      href = c.attr("href"),
      dateText = text(
        c.find(".date-wrapper").first().clone().find(".category-icon").remove().end().text(),
      ),
      title = text(c.find("h3").first().text());
    if (/^PAST\b/i.test(dateText)) {
      // The publisher labels the card as ended; it is not an upcoming event.
      past++;
      return;
    }
    const [dates, hours = ""] = dateText.split("|").map((s) => s.trim());
    const m = href.match(/-(\d{4}-\d\d-\d\d)-(\d{4}-\d\d-\d\d)(?:-[\d-]+)?$/);
    const labels = [
      ...dates.matchAll(
        /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/gi,
      ),
    ].map((x) => parseLabel(x[0]));
    const startDate = m?.[1],
      endDate = m?.[2];
    const multiDay = startDate !== endDate;
    const consistent =
      m &&
      validDate(startDate) &&
      validDate(endDate) &&
      endDate >= startDate &&
      agrees(startDate, labels[0]) &&
      agrees(endDate, multiDay ? labels[1] : labels[0]);
    if (!consistent) {
      rejected++;
      conflicts.push({ title, href, label: dates });
      return;
    }
    const times = clock(hours.replace(/\bFree\b/i, "").trim());
    // A time beside a multi-day range describes each day, not the range.
    const venue = text(c.find("b").first().text()),
      address = text(c.find("address").first().text());
    const warnings = [];
    if (multiDay && hours) warnings.push("daily_hours_listed_for_multi_day");
    const record = eventRecord(
      config,
      {
        id: href.replace(/^\/event\//, ""),
        title,
        url: new URL(href, url).href,
        startDate: !multiDay && times ? `${startDate}T${times.start}:00` : startDate,
        endDate:
          !multiDay && times?.end ? `${endDate}T${times.end}:00` : endDate,
        dateTimeBasis: {
          start: "card link date confirmed by card weekday/month/day",
          end: "card link date confirmed by card weekday/month/day",
        },
        location: {
          venue: venue && venue !== address ? venue : null,
          address,
          basis: "city guide listing card",
        },
        categoryTags: c
          .find(".tooltip-back")
          .map((_, e) => ({
            label: text($(e).text()),
            basis: "listing category icon",
          }))
          .get(),
        warnings,
        raw: { dateText, free: /\bFree\b/i.test(hours) || null },
      },
      { url, selector: "a.flex[href^='/event/']" },
    );
    if (record)
      records.push({ ...record, validationStatus: "parser-validated" });
    else rejected++;
  });
  // The heading states a larger count than the cards rendered; coverage is
  // never claimed from a listing whose total is not accounted for.
  const accounted = cards.length;
  if (!(Number.isFinite(stated) && stated === accounted))
    issues.push({
      code: "listed_total_not_reconciled",
      stated: Number.isFinite(stated) ? stated : null,
      cards: accounted,
    });
  return {
    records,
    nextRequests: [],
    terminal: false,
    coverage: "unverified",
    method: "cityguide-listing-cards",
    issues: [
      ...issues,
      ...(conflicts.length
        ? [
            {
              code: "card_date_conflict",
              count: conflicts.length,
              examples: conflicts.slice(0, 5),
            },
          ]
        : []),
    ],
    rejected,
    observedCount: cards.length,
    excluded: { past },
    discoveryLinks: [],
  };
}
