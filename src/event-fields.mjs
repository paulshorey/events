import { load } from "cheerio";

const clean = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const $ = load(`<body>${String(value)}</body>`);
  $("script,style,noscript,template").remove();
  return $("body").text().replace(/\s+/g, " ").trim() || null;
};
const named = (value) =>
  clean(value && typeof value === "object" ? value.name : value);
const present = (value) =>
  value !== null && value !== undefined && value !== "";

export function coordinates(value) {
  if (!value || typeof value !== "object") return null;
  const number = (v) =>
    typeof v === "number"
      ? v
      : typeof v === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())
        ? Number(v)
        : NaN;
  const latitude = number(value.latitude ?? value.lat),
    longitude = number(value.longitude ?? value.lng ?? value.lon);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}

export function locationFields(value, geoInput) {
  const places = Array.isArray(value) ? value : [value];
  const loc =
    places.find((p) => p && ![p["@type"]].flat().includes("VirtualLocation")) ??
    null;
  const object = loc && typeof loc === "object" ? loc : {};
  const address =
    object.address && typeof object.address === "object"
      ? object.address
      : object;
  const full = clean(
    object.formattedAddress ??
      (typeof object.address === "string"
        ? object.address
        : typeof loc === "string"
          ? loc
          : null),
  );
  const street = clean(
    address.streetAddress ??
      (typeof object.address === "string" ? object.address : null),
  );
  const result = {
    venue: named(object.venue ?? object.name),
    address: street, // Existing consumers retain the street/address text field.
    streetAddress: street,
    locality: named(address.locality ?? address.addressLocality),
    region: named(address.region ?? address.addressRegion),
    country: named(address.country ?? address.addressCountry),
    postalCode: clean(address.postalCode ?? address.zip),
    formattedAddress: full,
    basis: clean(object.basis) ?? "scraped event location",
  };
  // A publisher's neighborhood label is kept only when supplied.
  const neighborhood = clean(object.neighborhood);
  if (neighborhood) result.neighborhood = neighborhood;
  const geo =
    geoInput ??
    object.geoCoordinates ??
    object.geo ??
    (present(object.latitude) || present(object.longitude) ? object : null);
  const geoCoordinates = coordinates(geo);
  return {
    location: Object.entries(result).some(([key, v]) => key !== "basis" && v)
      ? result
      : null,
    geoCoordinates,
    warnings:
      geo && !geoCoordinates ? ["invalid_or_incomplete_coordinates"] : [],
    virtual: places.some((p) =>
      [p?.["@type"]].flat().includes("VirtualLocation"),
    ),
  };
}

export function fieldQuality(record) {
  const missing = [];
  if (!record.startDate) missing.push("start_date");
  if (!record.endDate) missing.push("end_date");
  if (!record.startLocal && record.allDay !== true) missing.push("start_time");
  if (!record.endLocal && record.allDay !== true) missing.push("end_time");
  if (!record.location && !record.geoCoordinates) missing.push("location");
  const issues = (record.warnings ?? []).filter((w) =>
    /invalid_or_incomplete_coordinates|source_zero_duration|conflict|requires_date_review/.test(
      w,
    ),
  );
  return {
    status: missing.length
      ? "needs_detail"
      : issues.length
        ? "needs_review"
        : "fields_present",
    missing,
    issues,
    // Presence is a quality diagnostic, not semantic verification or publication approval.
    needsDetail: missing.length > 0,
    needsReview: issues.length > 0,
  };
}

export function fieldSummary(records) {
  const count = (predicate) => records.filter(predicate).length;
  return {
    records: records.length,
    startDate: count((r) => r.startDate),
    endDate: count((r) => r.endDate),
    startTime: count((r) => r.startLocal),
    endTime: count((r) => r.endLocal),
    textLocation: count((r) => r.location),
    city: count((r) => r.location?.locality),
    coordinates: count((r) => r.geoCoordinates),
    needsDetail: count((r) => fieldQuality(r).needsDetail),
    needsReview: count((r) => fieldQuality(r).needsReview),
  };
}

export function sameOccurrenceTime(a, b) {
  if (!a || !b) return true;
  const offset = (value) => /(?:Z|[+-]\d\d:\d\d)$/.test(value);
  if (offset(a) && offset(b)) return Date.parse(a) === Date.parse(b);
  return a.slice(0, 16) === b.slice(0, 16);
}

// An explicitly inspected date-only listing can describe several performances.
// Keep its original observation, and project independently timed child occurrences.
export function matchDetailBindings(targets, details, config) {
  const enrichments = [],
    expansions = [];
  let matched = 0;
  for (const listing of targets) {
    const candidates = details
      .map((detail) => ({
        detail,
        merged: mergeDetail(listing, detail, {
          allowDateRange: config.adapter === "opencities",
          titleAliases: config.detailTitleAliases,
        }),
      }))
      .filter((c) => c.merged);
    if (candidates.length === 1) {
      enrichments.push(candidates[0].merged);
      matched++;
    } else if (
      config.expandSameDaySessions &&
      candidates.length > 1 &&
      !listing.startLocal &&
      listing.startDate === listing.endDate &&
      candidates.every(
        (c) => c.detail.startDate === listing.startDate && c.detail.startLocal,
      ) &&
      new Set(candidates.map((c) => c.detail.startLocal)).size ===
        candidates.length
    ) {
      expansions.push({
        parentRecordId: listing.sourceRecordId,
        records: candidates.map(({ detail, merged }) => ({
          ...merged,
          listingRecordId: listing.sourceRecordId,
          sourceRecordId: `${listing.sourceRecordId}|session=${detail.startLocal}`,
        })),
      });
      matched++;
    }
  }
  return { enrichments, expansions, matched };
}

export function mergeDetail(
  listing,
  detail,
  { allowDateRange = false, titleAliases = {} } = {},
) {
  const title = (value) =>
    value
      .toLowerCase()
      .replace(/(?:\.{3}|…).*$/, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const alias =
    Object.hasOwn(titleAliases, listing.title) &&
    typeof titleAliases[listing.title] === "string"
      ? titleAliases[listing.title]
      : listing.title;
  const a = title(alias),
    b = title(detail.title);
  // The requested page identity is checked by the worker. Also require the
  // event title and occurrence date, so recommendation cards cannot enrich it.
  if (!a || !b || !(a === b || (a.length >= 18 && b.startsWith(a))))
    return null;
  if (
    listing.startDate !== detail.startDate &&
    !(
      listing.startLocal &&
      detail.startLocal &&
      /(?:Z|[+-]\d\d:\d\d)$/.test(listing.startLocal) &&
      /(?:Z|[+-]\d\d:\d\d)$/.test(detail.startLocal) &&
      sameOccurrenceTime(listing.startLocal, detail.startLocal)
    ) &&
    !(
      allowDateRange &&
      detail.endDate &&
      listing.startDate >= detail.startDate &&
      listing.startDate <= detail.endDate
    )
  )
    return null;
  if (!sameOccurrenceTime(listing.startLocal, detail.startLocal)) return null;
  const result = {
    ...listing,
    fieldEvidence: { ...(listing.fieldEvidence ?? {}) },
    raw: { listing: listing.raw, detail: detail.raw },
    evidence: {
      ...listing.evidence,
      details: [...(listing.evidence.details ?? []), detail.evidence],
    },
  };
  for (const key of [
    "startDate",
    "endDate",
    "startLocal",
    "endLocal",
    "geoCoordinates",
    "allDay",
  ])
    if (detail[key] !== null && detail[key] !== undefined) {
      result[key] = detail[key];
      result.fieldEvidence[key] = detail.evidence;
    }
  if (detail.location) {
    result.location = { ...listing.location };
    for (const [key, value] of Object.entries(detail.location))
      if (value) {
        result.location[key] = value;
        result.fieldEvidence[`location.${key}`] = detail.evidence;
      }
  }
  if (detail.timeZoneLabel) result.timeZoneLabel = detail.timeZoneLabel;
  if (detail.timeZoneBasis && detail.timeZoneBasis !== "collection setting") {
    result.timeZone = detail.timeZone;
    result.timeZoneBasis = detail.timeZoneBasis;
  }
  if (result.startDate !== listing.startDate && !detail.startLocal)
    result.startLocal = null;
  if (result.endDate !== listing.endDate && !detail.endLocal)
    result.endLocal = null;
  result.dateTimePrecision = {
    start: result.startLocal ? "datetime" : "date",
    end: result.endLocal ? "datetime" : result.endDate ? "date" : "unknown",
  };
  result.dateTimeBasis = {
    start: detail.dateTimeBasis?.start ?? listing.dateTimeBasis?.start,
    end: detail.dateTimeBasis?.end ?? listing.dateTimeBasis?.end,
  };
  result.warnings = [
    ...new Set([...listing.warnings, ...detail.warnings]),
  ].filter((w) => w !== "end_date_not_supplied" || !result.endDate);
  result.fieldQuality = fieldQuality(result);
  return result;
}
