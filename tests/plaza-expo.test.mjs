import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "../src/adapters/document.mjs";
import { registry } from "../src/registry.mjs";

const config = (await registry()).find((c) => c.id === "url-098");
const html = await readFile(
  new URL("./fixtures/plaza-expo.html", import.meta.url),
  "utf8",
);
const parse = (body) => parseDocument({ html: body, url: config.url, config });
test("Plaza's named expo retains venue, edition and printed hours", () => {
  const result = parse(html);
  assert.equal(result.records.length, 1);
  const [r] = result.records;
  assert.equal(r.startDate, "2026-12-03");
  assert.equal(r.endDate, "2026-12-12");
  assert.equal(r.location.locality, "Las Vegas");
  assert.equal(r.raw.hours, "9am - 4:30pm");
  assert.equal(r.startLocal, null);
  assert.equal(r.endLocal, null);
  assert.equal(r.validationStatus, "parser-validated");
  assert.equal(result.terminal, true);
});
test("Plaza edition, location and field labels must remain explicit and unambiguous", () => {
  for (const changed of [
    html.replace("12, 2026", "12"),
    html.replace("Plaza Convention Center", "Other Venue"),
    html.replace("Nevada 89101", "California 89101"),
    html.replace("LOCATION", "DATE"),
    html.replace("December 3 - 12", "December 32 - 39"),
  ]) {
    assert.throws(() => parse(changed), { code: "contract_changed" });
  }
});
