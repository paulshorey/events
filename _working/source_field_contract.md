# Events extraction: date, time and location contract

New framework and prototype CLI outputs use `schemaVersion: 3`. Historical captures and observations retain their original schema and values. This work does not migrate the remote databases or enable collection schedules.

## Date and time

Every observation contains these properties, including explicit nulls:

| Field | Meaning |
| --- | --- |
| `startDate` | Source-supported calendar date, `YYYY-MM-DD`; required for an event candidate |
| `endDate` | Source-supported end calendar date; null when the source does not establish it |
| `startLocal` | Source date and clock in ISO form, retaining an explicit UTC offset when supplied; null when the hour is unknown |
| `endLocal` | Source end date and clock; null when unknown |
| `timeZone` | Source IANA zone or the collection setting, with `timeZoneBasis` distinguishing them |
| `timeZoneLabel` | A displayed abbreviation such as `CDT` when available; it does not establish an IANA zone or offset by itself |
| `dateTimePrecision` | Separate `date`, `datetime`, or `unknown` precision for each boundary |
| `dateTimeBasis` | The source field or inspected visible occurrence element behind each boundary |

A structured `startDate` alone does not establish an end date. A visible listing date/range can establish day-level boundaries; the basis makes that distinction explicit. Missing hours are never filled with midnight, and a missing end time never receives an arbitrary duration. Date-only values are not automatically all-day events.

This follows the [official event date/time guidance](https://developers.google.com/search/docs/appearance/structured-data/event): retain date precision when hours are unavailable and preserve accurate offsets. These are acquisition records, not website structured-data markup.

Impossible dates, malformed clocks, and reversed comparable timestamps are rejected. Overnight dates and changing explicit offsets across daylight-saving transitions are retained. A zero-duration timed event is retained as a source claim and flagged for review.

The October 17 browser audit found that Boston's event JSON-LD can contain a metadata timestamp instead of the visible occurrence date. Its inspected visible date/time elements take precedence, with conflicting structured claims retained in `raw.structuredCandidates`. The verified AllEvents-owned `all.events` destination can label local clock values as UTC while displaying a different timezone. Its visible clock and abbreviation are retained without inventing an offset, and the conflict requires review.

## Two location properties

`geoCoordinates` contains either numeric `{ latitude, longitude }` or null. Coordinates come only from event-scoped structured data, an explicit API venue coordinate, or an inspected event map marker/destination. No geocoder is used. Empty strings and missing values never become zero. Non-numeric, partial, non-finite, or out-of-range pairs are flagged and excluded. A valid zero coordinate is retained.

`location` contains the scraped text fields or null:

```json
{
  "venue": "The Fairgrounds Nashville",
  "streetAddress": "625 Smith Ave, Nashville, TN 37203, United States",
  "address": "625 Smith Ave, Nashville, TN 37203, United States",
  "locality": "Nashville",
  "region": "TN",
  "country": "US",
  "postalCode": "37203",
  "formattedAddress": null,
  "basis": "upstream structured data"
}
```

This is a captured AllEvents example. `address` is retained as the compatibility alias for existing consumers; `streetAddress` is the explicit field name. Some upstream street fields contain the full address, so the original text is preserved. A bare location string is retained as `formattedAddress` without guessing its components. Country names/codes remain source claims for later normalization.

The separate `geoCoordinates` value for this captured example is `{ "latitude": 36.1313039, "longitude": -86.76156689999999 }`.

A source's `marketCity` remains provenance. It does not populate missing venue locality, region, country, or coordinates. A virtual venue is not converted to a physical street address. Publisher footer addresses and map viewport centers are not generic event-location fallbacks.

## Detail acquisition and immutable evidence

Seventeen inspected collection configurations opt into `enrichDetails`. Sparse listing records queue event detail pages, ahead of unrelated discovered links and within the existing request/depth/runtime limits. Verified allowed hosts govern navigation; AllEvents includes its browser-verified `all.events` destination.

Details must match the requested event title and occurrence date/time. Recommendation cards and different recurring occurrences cannot enrich the listing. OpenCities' explicit detail date ranges may encompass the listing's next-date display. Unmatched detail occurrences remain issues requiring review; source disagreements do not justify weakening identity checks.

Journal schema version 2 adds append-only `record_enrichments` linked to their original observation and detail page. A checkpoint saves enrichment, page completion, and its frontier transactionally under the fenced lease. `Journal.records()` and JSONL exports project the enriched view while the original observation payload remains intact. Field evidence identifies the detail capture behind richer values. The future database uploader must deliver both original observations and these enrichment observations.

## Quality outcomes

Every new record contains `fieldQuality`: missing date/time/location fields, review issues, and a `needs_detail`, `needs_review`, or `fields_present` status. Each run also includes aggregate field counts. Coordinates are optional; their absence does not itself fail an event.

`fields_present` establishes presence and shape, not semantic accuracy, complete source coverage, or publication approval. Missing source fields and access restrictions remain explicit. A complete enumeration can still contain records requiring detail work or semantic review. Scraper repair tickets still require the existing two-complete-run probation process; this audit closes none automatically.

## Repeatable inspection

```sh
# Bounded browser audit: at most one listing and one sampled detail per entry.
node scripts/audit-source-fields.mjs --root .artifacts/field-audits/new-audit --details 1 --concurrency 3

# Restrict a follow-up to particular sources. Use a fresh root after parser changes.
node scripts/audit-source-fields.mjs --root .artifacts/field-audits/follow-up --ids url-002,url-025,url-080 --details 1

# Reparse saved rendered captures without visiting websites or modifying runs.
node scripts/report-source-fields.mjs --input .artifacts/field-audits/new-audit/audit.json --input .artifacts/field-audits/follow-up/audit.json
```

The report requires an inspection entry for all 97 registry URLs. Browser audit roots and full captures remain ignored local evidence; commit bounded regression fixtures and the per-source summary. The audit uses isolated state and never registers jobs in the operational `.artifacts/framework/journal.sqlite`.
