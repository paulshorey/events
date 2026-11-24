import { load } from "cheerio";
import { createHash } from "node:crypto";
import { parseDateRange } from "../examples/parsers.mjs";
import { locationFields, fieldQuality } from "./event-fields.mjs";
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
    if (
      u.pathname.split("/").some((part) => /^(?:undefined|null)$/i.test(part))
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function validTimestamp(value) {
  if (typeof value !== "string") return false;
  const m = value.match(
    /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/,
  );
  if (
    !m ||
    !validDate(m[1]) ||
    Number(m[2]) > 23 ||
    Number(m[3]) > 59 ||
    Number(m[4] ?? 0) > 59
  )
    return false;
  if (m[5] && m[5] !== "Z") {
    const [h, min] = m[5].slice(1).split(":").map(Number);
    if (h > 23 || min > 59) return false;
  }
  return true;
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
  // A single structured startDate does not establish an end. A visible listing
  // date/range is retained at day precision, with its separate basis below.
  const visibleDateEvidence =
    input.rawDate &&
    input.rawDateBasis !== "start_attribute" &&
    !/^\d{4}-\d\d-\d\dT/.test(String(input.rawDate));
  const endDate = end.startDate ?? (visibleDateEvidence ? range.endDate : null),
    base = evidence.url ?? config.url,
    url = safeUrl(input.url, base) ?? safeUrl(input["@id"], base);
  if (
    !title ||
    !title.length ||
    title.length > 500 ||
    !url ||
    !startDate ||
    (endDate && endDate < startDate)
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
  if (
    (/^\d{4}-\d\d-\d\dT/.test(startRaw) && !validTimestamp(startRaw)) ||
    (/^\d{4}-\d\d-\d\dT/.test(endRaw) && !validTimestamp(endRaw)) ||
    (startLocal &&
      (!validTimestamp(startLocal) || startLocal.slice(0, 10) !== startDate)) ||
    (endLocal &&
      (!validTimestamp(endLocal) || endLocal.slice(0, 10) !== endDate))
  )
    return null;
  if (startLocal && endLocal) {
    const offset = (v) => /(?:Z|[+-]\d\d:\d\d)$/.test(v);
    if (
      offset(startLocal) === offset(endLocal) &&
      (offset(startLocal)
        ? Date.parse(endLocal) < Date.parse(startLocal)
        : endLocal < startLocal)
    )
      return null;
  }
  const fields = locationFields(input.location, input.geoCoordinates);
  const identity = String(
    input.id ??
      input.sourceRecordId ??
      `${input["@id"] ?? url}|${startDate}|${startLocal ?? ""}`,
  );
  const record = {
    schemaVersion: 3,
    collectionId: config.id,
    sourceId: config.sourceKey,
    sourceRecordId: identity,
    title,
    url,
    startDate,
    endDate,
    startLocal,
    endLocal,
    dateTimePrecision: {
      start: startLocal ? "datetime" : "date",
      end: endLocal ? "datetime" : endDate ? "date" : "unknown",
    },
    dateTimeBasis: input.dateTimeBasis ?? {
      start: input.startDate ? "source startDate" : "visible listing date",
      end: input.endDate
        ? "source endDate"
        : visibleDateEvidence
          ? "visible listing date/range"
          : null,
    },
    timeZone: input.timeZone ?? (config.cityMarket ? config.timeZone : null),
    timeZoneLabel: input.timeZoneLabel ?? null,
    timeZoneBasis:
      input.timeZoneBasis ??
      (input.timeZone
        ? "source time zone"
        : config.cityMarket && config.timeZone
          ? "collection setting"
          : null),
    allDay: input.allDay ?? null,
    location: fields.location,
    geoCoordinates: fields.geoCoordinates,
    marketCity: config.cityMarket ?? null,
    sourceGroups: [config.group],
    categoryTags:
      input.categoryTags ??
      config.categoryHints.map((label) => ({
        label,
        basis: "source-level hint",
      })),
    validationStatus: "extracted-candidate",
    warnings: [
      ...new Set([
        ...(input.warnings ?? []),
        ...fields.warnings,
        ...(startLocal &&
        endLocal &&
        input.allDay !== true &&
        (startLocal === endLocal ||
          (/(?:Z|[+-]\d\d:\d\d)$/.test(startLocal) &&
            /(?:Z|[+-]\d\d:\d\d)$/.test(endLocal) &&
            Date.parse(startLocal) === Date.parse(endLocal)))
          ? ["source_zero_duration_timed_event"]
          : []),
        ...(!endDate ? ["end_date_not_supplied"] : []),
        ...(fields.virtual ? ["virtual_location_present"] : []),
      ]),
    ],
    evidence,
    raw: input.raw ?? input,
  };
  record.fieldQuality = fieldQuality(record);
  return record;
}
export function jsonLdEvents(html, { series = false } = {}) {
  const $ = load(html),
    events = [],
    references = Object.create(null),
    parseErrors = [];
  const walk = (obj, path) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((o, i) => walk(o, `${path}[${i}]`));
      return;
    }
    if (
      typeof obj["@id"] === "string" &&
      Object.keys(obj).length > Object.keys(references[obj["@id"]] ?? {}).length
    )
      references[obj["@id"]] = obj;
    const types = [obj["@type"]].flat().filter(Boolean);
    if (
      types.some(
        (type) =>
          /(?:^|\/)(?:[A-Za-z]*Event|Festival)$/.test(type) &&
          !["EventVenue", "EventSeries"].includes(type),
      ) ||
      // An EventSeries is an occurrence only when the publisher gives it its
      // own start date (opt-in per source; nested superEvent stubs have none).
      (series &&
        types.some((type) => /(?:^|\/)EventSeries$/.test(type)) &&
        obj.startDate)
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
  return { events, parseErrors, references };
}
export function recordFromJsonLd(config, event, evidence, references = {}) {
  const resolve = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 3) return value;
    if (Array.isArray(value)) return value.map((v) => resolve(v, depth + 1));
    const resolved = { ...(references[value["@id"]] ?? {}), ...value };
    for (const key of ["address", "geo"])
      if (resolved[key]) resolved[key] = resolve(resolved[key], depth + 1);
    return resolved;
  };
  const locations = resolve(event.location);
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
      location: Array.isArray(locations)
        ? locations.map((loc) =>
            typeof loc === "object" && loc
              ? { ...loc, basis: "upstream structured data" }
              : loc,
          )
        : locations && typeof locations === "object"
          ? { ...locations, basis: "upstream structured data" }
          : locations,
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
// Records sharing an identity but disagreeing on core event fields are
// different events that one identity would silently merge.
const coreOf = (r) =>
  JSON.stringify([
    r.title,
    r.startDate,
    r.endDate,
    r.startLocal,
    r.endLocal,
    r.location?.venue,
    r.location?.formattedAddress,
  ]);
export function identityCollisions(records) {
  const seen = new Map();
  let collisions = 0;
  for (const r of records) {
    const core = coreOf(r);
    if (!seen.has(r.sourceRecordId)) seen.set(r.sourceRecordId, core);
    else if (seen.get(r.sourceRecordId) !== core) collisions++;
  }
  return collisions;
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
