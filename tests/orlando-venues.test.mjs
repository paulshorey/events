import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";

const configs = await registry();
const config = (id) => configs.find((c) => c.id === id);
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
const listing = async (id, name) => {
  const c = config(id);
  return parseDocument({
    html: await fixture(name),
    url: c.url,
    config: { ...c, maxDepth: 0 },
  });
};

test("ExpoFP venue page yields calendar rows and floor-plan cards with source years", async () => {
  const r = await listing("url-088", "expofp-venue");
  assert.equal(r.records.length, 5);
  assert.equal(r.rejected, 0);
  const by = (t) => r.records.find((x) => x.title === t);
  assert.equal(by("AAPM&R Annual Assembly").startDate, "2026-11-11");
  assert.equal(by("AAPM&R Annual Assembly").endDate, "2026-11-14");
  assert.equal(
    by("AAPM&R Annual Assembly").url,
    "https://expofp.com/orange-county-convention-center/aapm-and-r-annual-assembly-2026",
  );
  assert.equal(by("I/ITSEC").startDate, "2026-11-30");
  assert.equal(by("I/ITSEC").endDate, "2026-12-04");
  const iaapa = by("IAAPA Expo 2026");
  assert.equal(iaapa.startDate, "2026-11-17");
  assert.equal(iaapa.endDate, "2026-11-21");
  assert.equal(iaapa.url, "https://iaapaexpo2026.expofp.com/");
  assert.equal(iaapa.raw.website, "iaapa.org/expos-and-events/iaapa-expo");
  for (const e of r.records) {
    assert.equal(e.location.venue, "Orange County Convention Center");
    assert.equal(e.startLocal, null);
    assert.equal(e.dateTimePrecision.start, "date");
  }
  assert.notEqual(r.coverage, "verified-list");
});

test("Ramada guide rows become dated venue observations without invented event pages", async () => {
  const r = await listing("url-089", "ramada-orlando-occc");
  assert.equal(r.records.length, 7);
  const surf = r.records.find((x) => x.title === "Surf Expo");
  assert.equal(surf.startDate, "2026-09-16");
  assert.equal(surf.endDate, "2026-09-18");
  assert.equal(
    surf.url,
    "https://www.ramadaorlando.com/orange-county-convention-center-events/#surf-expo",
  );
  const ems = r.records.filter((x) => x.title === "2026 EMS World Expo");
  assert.deepEqual(
    ems.map((x) => [x.startDate, x.endDate]),
    [
      ["2026-09-28", "2026-10-02"],
      ["2026-10-01", "2026-10-02"],
    ],
  );
  assert.equal(
    new Set(r.records.map((x) => x.sourceRecordId)).size,
    r.records.length,
  );
  assert.notEqual(r.coverage, "verified-list");
});

test("Wyndham guide parses both paragraph layouts and counts a repeated month row once", async () => {
  const r = await listing("url-092", "wyndham-occc");
  assert.deepEqual(
    r.records.map((x) => [x.title, x.startDate, x.endDate]),
    [
      ["Metalcon 2026", "2026-10-07", "2026-10-09"],
      ["IAPPA Expo 2026", "2026-11-18", "2026-11-20"],
      ["Assemblies of God General Council 2027", "2027-08-02", "2027-08-06"],
      ["CEO Gaming 2027", "2027-08-30", "2027-09-07"],
    ],
  );
  assert.equal(r.excluded.repeatedMonthRows, 1);
});

test("VisitOrlando.city detail keeps the upstream event URL identity and a single visible clock", async () => {
  const c = config("url-095");
  const url = "https://www.visitorlando.city/events/773";
  const r = parseDocument({
    html: await fixture("visitorlando-city-detail"),
    url,
    config: c,
    task: { kind: "detail", depth: 1, meta: {} },
  });
  assert.equal(r.records.length, 1);
  const e = r.records[0];
  assert.equal(e.title, "The Neighbourhood");
  assert.equal(
    e.url,
    "https://www.visitorlando.com/event/the-neighbourhood/33730/",
  );
  assert.match(e.sourceRecordId, /33730/);
  assert.equal(e.startLocal, "2026-11-11T19:30:00");
  assert.equal(e.endLocal, null);
  assert.equal(e.location.venue, "Kia Center");
});

test("VisitOrlando.city detail prefers its visible city when it shares the postal code, and ignores unparseable times", async () => {
  const c = config("url-095");
  const r = parseDocument({
    html: await fixture("visitorlando-city-detail-other-city"),
    url: "https://www.visitorlando.city/events/774",
    config: c,
    task: { kind: "detail", depth: 1, meta: {} },
  });
  const e = r.records[0];
  assert.equal(e.location.locality, "Daytona Beach");
  assert.equal(e.location.postalCode, "32114");
  assert.equal(e.startLocal, null);
  assert.equal(e.endDate, "2026-11-15");
});

test("a mismatched event URL is still skipped unless the source opts in", async () => {
  const c = config("url-095");
  const r = parseDocument({
    html: await fixture("visitorlando-city-detail"),
    url: "https://www.visitorlando.city/events/773",
    config: { ...c, detailEventIdentity: undefined },
    task: { kind: "detail", depth: 1, meta: {} },
  });
  assert.equal(r.records.length, 0);
});
