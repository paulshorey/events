import { load } from "cheerio";
import { eventRecord, jsonLdEvents, text, validDate } from "../records.mjs";

// DoThis NYC street-fair calendar: a server-rendered week of days
// (`.cl-cal-month[data-period-group=YYYY-MM-DD]`) whose rows are curated fairs
// and city street-activity permits. Each day group carries its ISO date, so no
// year is inferred from the "Thu, Nov 5" label.
const clock = (value) => {
  const m = String(value ?? "")
    .trim()
    .match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
    );
  if (!m) return null;
  const to24 = (h, min, ap) => {
    const hour = (Number(h) % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    if (Number(h) < 1 || Number(h) > 12 || Number(min ?? 0) > 59) return null;
    return `${String(hour).padStart(2, "0")}:${min ?? "00"}`;
  };
  const start = to24(m[1], m[2], m[3]),
    end = to24(m[4], m[5], m[6]);
  return start && end && end > start ? { start, end } : null;
};

const weekdayOf = (day) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
const monthDay = (day) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
function weekDay(start, label) {
  const hits = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (label === `${weekdayOf(iso)}, ${monthDay(iso)}`) hits.push(iso);
  }
  return hits.length === 1 ? hits[0] : null;
}

export function parseStreetFairs({ html, url, config }) {
  const $ = load(html),
    records = [],
    issues = [];
  const ld = jsonLdEvents(html).events.map((e) => e.event);
  const ldByUrl = new Map(
    ld.map((e) => [String(e.url ?? "").split("#e=")[1], e]),
  );
  const groups = $(".cl-cal-month[data-period-group]");
  if (!groups.length)
    throw Object.assign(new Error("Street fair day groups missing"), {
      code: "contract_changed",
    });
  let rows = 0,
    rejected = 0;
  const perGroup = {};
  groups.each((_, g) => {
    const key = $(g).attr("data-period-group"),
      m = key?.match(/^(w:)?(\d{4}-\d\d-\d\d)$/);
    if (!m || !validDate(m[2])) {
      rejected++;
      return;
    }
    $(g)
      .find("tbody tr")
      .each((_, tr) => {
        rows++;
        perGroup[key] = (perGroup[key] ?? 0) + 1;
        const row = $(tr),
          a = row.find("th a[href^='#e=']").first(),
          slug = (a.attr("href") ?? "").slice(3),
          type = row.attr("data-type") || "fair",
          cells = row.find("td"),
          label = text(cells.eq(0).text()),
          street = text(
            cells.eq(1).clone().children("small").remove().end().text(),
          ),
          place = text(cells.eq(1).find("small").first().text()),
          hours = text(cells.eq(2).text());
        const warnings = [];
        // A day group is one ISO date. A week group is seven ISO dates from
        // its start; the row's "Sat, Nov 7" label must name exactly one of
        // them by weekday, month and day. No year is inferred outside it.
        const day = m[1] ? weekDay(m[2], label) : m[2];
        if (!day) {
          rejected++;
          return;
        }
        const dataDate = a.attr("data-date");
        if (dataDate && dataDate !== day) warnings.push("source_date_conflict");
        if (!m[1] && label && !label.startsWith(weekdayOf(day)))
          warnings.push("source_date_conflict");
        const isPermit = type !== "fair";
        const times = clock(hours);
        const title =
          text(a.text()) ||
          text(
            row
              .find(".cl-cal-permit")
              .first()
              .clone()
              .children()
              .remove()
              .end()
              .text(),
          );
        const known = slug ? ldByUrl.get(slug) : null;
        const knownDay = known?.startDate?.slice(0, 10) === day ? known : null;
        if (isPermit)
          warnings.push("permit_window_not_necessarily_public_hours");
        if (!isPermit && !times && hours) warnings.push("hours_not_parsed");
        const record = eventRecord(
          config,
          {
            // Unlinked permits are identified by title, street and place too,
            // so two same-named permits on one day stay distinct.
            id: slug ? `${slug}|${day}` : `${title}|${day}|${street}|${place}`,
            title,
            // A permit row can have no link of its own; it is identified by
            // its title on the calendar page.
            url: `${url.split("#")[0]}#${slug ? `e=${slug}` : `permit-${encodeURIComponent(`${title}|${street}`)}`}`,
            startDate: !isPermit && times ? `${day}T${times.start}:00` : day,
            endDate: !isPermit && times ? `${day}T${times.end}:00` : day,
            dateTimeBasis: {
              start:
                !isPermit && times
                  ? "calendar row group date and posted hours"
                  : "calendar row group date",
              end:
                !isPermit && times
                  ? "calendar row posted hours"
                  : "calendar row group date",
            },
            location: {
              ...(knownDay?.location?.address
                ? {
                    venue: knownDay.location.name,
                    streetAddress: knownDay.location.address.streetAddress,
                    locality: knownDay.location.address.addressLocality,
                    region: knownDay.location.address.addressRegion,
                    country: knownDay.location.address.addressCountry,
                  }
                : { address: street }),
              neighborhood: place || null,
              basis: "street fair calendar row",
            },
            geoCoordinates: knownDay?.location?.geo
              ? {
                  latitude: knownDay.location.geo.latitude,
                  longitude: knownDay.location.geo.longitude,
                }
              : null,
            categoryTags: [
              {
                label: text(row.find(".cl-cal-type").text()) || "Street fair",
                basis: "calendar row type",
              },
            ],
            warnings,
            raw: {
              day,
              type,
              label,
              street,
              place,
              hours,
              history: text(row.find(".cl-cal-history").text()) || null,
            },
          },
          { url, selector: ".cl-cal-month tbody tr" },
        );
        if (record)
          records.push({ ...record, validationStatus: "parser-validated" });
        else rejected++;
      });
  });
  // The page states how many fairs it lists, and each day button repeats its
  // own count; both must agree with the rows actually parsed.
  const stated = Number(
      text($("main, body").first().text()).match(
        /(\d+)\s+street fairs? in the next \d+ days/i,
      )?.[1],
    ),
    buttons = $(".cl-cal-months button[data-period]")
      .map((_, b) => ({
        day: $(b).attr("data-period"),
        n: Number(text($(b).find("span").text())) || 0,
      }))
      .get();
  const buttonsAgree =
    buttons.length === groups.length &&
    buttons.every((b) => (perGroup[b.day] ?? 0) === b.n);
  // "N street fairs in the next 7 days" covers the first seven calendar days.
  const first = groups.first().attr("data-period-group")?.replace(/^w:/, ""),
    windowEnd = validDate(first)
      ? new Date(new Date(`${first}T12:00:00Z`).getTime() + 6 * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
  const inWindow = records.filter(
    (r) => windowEnd && r.startDate >= first && r.startDate <= windowEnd,
  ).length;
  const countsAgree =
    Number.isFinite(stated) &&
    stated === inWindow &&
    rejected === 0 &&
    buttonsAgree;
  if (!countsAgree)
    issues.push({
      code: "street_fair_counts_disagree",
      stated: Number.isFinite(stated) ? stated : null,
      rows,
      inWindow,
    });
  if (rejected)
    issues.push({ code: "street_fair_rows_rejected", count: rejected });
  return {
    records,
    nextRequests: [],
    terminal: countsAgree,
    coverage: countsAgree ? "verified-list" : "unverified",
    method: "dothis-street-fair-calendar",
    issues,
    rejected,
    observedCount: rows,
    discoveryLinks: [],
  };
}
