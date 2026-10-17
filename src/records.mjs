import { load } from "cheerio";
import { createHash } from "node:crypto";
import { parseDateRange } from "../examples/parsers.mjs";
export const text = (value) =>
  value == null
    ? ""
    : load(`<body>${String(value)}</body>`)("body")
        .text()
        .replace(/\s+/g, " ")
        .trim();
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [y, m, d] = value.split("-").map(Number),
    dt = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1900 &&
    y <= 2200 &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
export function dates(value) {
  const raw = text(value)
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-");
  const iso = raw.match(/\b\d{4}-\d{2}-\d{2}(?=T|\b)/g);
  if (iso?.length)
    return {
      startDate: validDate(iso[0]) ? iso[0] : null,
      endDate: validDate(iso.at(-1)) ? iso.at(-1) : null,
    };
  const normalized = raw
    .replace(/\b([A-Za-z]{3})\./g, "$1")
    .replace(/([A-Za-z])(\d)/g, "$1 $2");
  const exact = parseDateRange(normalized);
  if (exact.startDate) return exact;
  const m = normalized.match(
    /\b([A-Za-z]{3,9}\s+\d{1,2}(?:\s*-\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2})?,?\s+\d{4})\b/g,
  );
  if (m?.length) {
    const a = parseDateRange(m[0].replace(/(\d)\s+(\d{4})$/, "$1, $2"));
    const b = parseDateRange(m.at(-1).replace(/(\d)\s+(\d{4})$/, "$1, $2"));
    return { startDate: a.startDate, endDate: b.endDate };
  }
  const numeric = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (numeric) {
    const d = `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
    if (validDate(d)) return { startDate: d, endDate: d };
  }
  return { startDate: null, endDate: null };
}
export function safeUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value, base);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function eventRecord(config, input, evidence) {
  const title = text(input.title ?? input.name),
    range = dates(input.startDate ?? input.rawDate),
    end = dates(input.endDate ?? "");
  if (input.endDate && !end.startDate) return null;
  const startDate =
    input.startDate && validDate(String(input.startDate).slice(0, 10))
      ? String(input.startDate).slice(0, 10)
      : range.startDate;
  const endDate = end.startDate ?? range.endDate ?? startDate,
    url = safeUrl(input.url ?? input["@id"], evidence.url ?? config.url);
  if (
    !title ||
    title.length < 3 ||
    title.length > 500 ||
    !url ||
    !startDate ||
    !endDate ||
    endDate < startDate
  )
    return null;
  const startRaw = String(input.startDate ?? ""),
    endRaw = String(input.endDate ?? "");
  const startLocal =
    input.startLocal ??
    (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(startRaw) ? startRaw : null);
  const endLocal =
    input.endLocal ??
    (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(endRaw) ? endRaw : null);
  const identity = String(
    input.id ??
      input.sourceRecordId ??
      `${input["@id"] ?? url}|${startDate}|${startLocal ?? ""}`,
  );
  return {
    schemaVersion: 2,
    collectionId: config.id,
    sourceId: config.sourceKey,
    sourceRecordId: identity,
    title,
    url,
    startDate,
    endDate,
    startLocal,
    endLocal,
    timeZone: input.timeZone ?? (config.cityMarket ? config.timeZone : null),
    allDay: input.allDay ?? null,
    location: input.location ?? null,
    marketCity: config.cityMarket ?? null,
    sourceGroups: [config.group],
    categoryTags:
      input.categoryTags ??
      config.categoryHints.map((label) => ({
        label,
        basis: "source-level hint",
      })),
    validationStatus: "extracted-candidate",
    warnings: input.warnings ?? [],
    evidence,
    raw: input.raw ?? input,
  };
}
export function jsonLdEvents(html) {
  const $ = load(html),
    events = [],
    parseErrors = [];
  const walk = (obj, path) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((o, i) => walk(o, `${path}[${i}]`));
      return;
    }
    const types = [obj["@type"]].flat().filter(Boolean);
    if (
      types.some(
        (type) =>
          /(?:^|\/)(?:[A-Za-z]*Event|Festival)$/.test(type) &&
          !["EventVenue", "EventSeries"].includes(type),
      )
    )
      events.push({ event: obj, path });
    for (const [key, v] of Object.entries(obj))
      if (v && typeof v === "object") walk(v, `${path}.${key}`);
  };
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      walk(JSON.parse($(el).text()), `jsonld[${i}]`);
    } catch (error) {
      parseErrors.push(error.message.slice(0, 100));
    }
  });
  return { events, parseErrors };
}
export function recordFromJsonLd(config, event, evidence) {
  const loc = Array.isArray(event.location)
      ? event.location[0]
      : event.location,
    address = loc?.address;
  const identifier =
    typeof event.identifier === "object"
      ? event.identifier?.value
      : event.identifier;
  return eventRecord(
    config,
    {
      ...event,
      title: event.name,
      id: identifier ? `${identifier}|${event.startDate}` : undefined,
      location: loc
        ? {
            venue: text(loc.name) || null,
            address:
              typeof address === "string"
                ? text(address)
                : (address?.streetAddress ?? null),
            locality:
              typeof address === "object"
                ? (address?.addressLocality ?? null)
                : null,
            region: address?.addressRegion ?? null,
            country:
              typeof address?.addressCountry === "object"
                ? (address.addressCountry?.name ?? null)
                : (address?.addressCountry ?? null),
            basis: "upstream structured data",
          }
        : null,
      categoryTags: event.keywords
        ? String(
            Array.isArray(event.keywords)
              ? event.keywords.join(",")
              : event.keywords,
          )
            .split(",")
            .map((label) => ({ label: text(label), basis: "upstream keyword" }))
        : undefined,
      raw: event,
    },
    evidence,
  );
}
export function dedupe(records) {
  return [...new Map(records.map((r) => [r.sourceRecordId, r])).values()];
}
export const fingerprint = (records) =>
  createHash("sha256")
    .update(
      records
        .map((r) => r.sourceRecordId)
        .sort()
        .join("\n"),
    )
    .digest("hex");
