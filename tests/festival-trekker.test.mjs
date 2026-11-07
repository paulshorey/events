import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseApi } from "../src/worker.mjs";
const configs = await registry();
const config = configs.find((c) => c.id === "url-006");
const body = await readFile(
  new URL("fixtures/festivaltrekker-geodir.json", import.meta.url),
  "utf8",
);
const url = `${config.apiEndpoint}?per_page=3&page=1`;

test("Festival Trekker GeoDirectory events keep source dates, clocks, address and coordinates", () => {
  const parsed = parseApi(
    body,
    url,
    config,
    { kind: "api" },
    {
      total: 6,
      totalPages: 2,
    },
  );
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.coverage, "api-query");
  assert.equal(parsed.expectedTotal, 6);
  assert.equal(parsed.terminal, false);
  assert.equal(
    new URL(parsed.nextRequests[0].url).searchParams.get("page"),
    "2",
  );
  const [first] = parsed.records;
  assert.equal(first.startDate, "2026-11-05");
  assert.equal(first.startLocal, "2026-11-05T20:00:00");
  // The API's "00:00" end placeholder is not an end time.
  assert.equal(first.endLocal, null);
  assert.equal(first.location.locality, "Chicago");
  assert.equal(first.location.region, "IL");
  assert.ok(first.geoCoordinates);
  assert.match(first.url, /^https:\/\/festivaltrekker\.com\/events\//);
});

test("Festival Trekker enumeration ends on the declared last page, or a short page without headers", () => {
  const last = parseApi(
    body,
    `${config.apiEndpoint}?per_page=3&page=2`,
    config,
    {},
    {
      total: 6,
      totalPages: 2,
    },
  );
  assert.equal(last.terminal, true);
  assert.equal(last.nextRequests.length, 0);
  // Without headers a full page continues and a short page terminates.
  assert.equal(parseApi(body, url, config, {}).terminal, false);
  assert.equal(
    parseApi(body, `${config.apiEndpoint}?per_page=50&page=1`, config, {})
      .terminal,
    true,
  );
  assert.equal(parseApi(body, url, config, {}).expectedTotal, undefined);
});

test("Festival Trekker rejects changed API shapes and surfaces recurring expansion", () => {
  assert.throws(
    () => parseApi("{}", url, config, {}),
    /GeoDirectory event array/,
  );
  assert.throws(() => parseApi("<html>", url, config, {}), /non-JSON/);
  const events = JSON.parse(body);
  delete events[0].event_dates;
  assert.throws(
    () => parseApi(JSON.stringify(events), url, config, {}),
    /identity or dates/,
  );
  const recurring = JSON.parse(body).slice(0, 1);
  recurring[0].event_dates.recurring = true;
  recurring[0].event_schedules = [
    {
      schedule_id: "1",
      start_date: { raw: "2026-11-05" },
      end_date: { raw: "2026-11-05" },
      start_time: { raw: "20:00" },
      end_time: { raw: "21:00" },
      all_day: "0",
    },
    {
      schedule_id: "2",
      start_date: { raw: "2026-11-12" },
      end_date: { raw: "2026-11-12" },
      start_time: { raw: "20:00" },
      end_time: { raw: "21:00" },
      all_day: "0",
    },
  ];
  const parsed = parseApi(
    JSON.stringify(recurring),
    url,
    config,
    {},
    {
      total: 1,
      totalPages: 1,
    },
  );
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[1].endLocal, "2026-11-12T21:00:00");
  assert.equal(parsed.expectedTotal, undefined);
  // Expansion is counted, not a run-failing page issue.
  assert.ok(parsed.recurringExpanded >= 1);
  assert.ok(!parsed.issues.some((i) => i.code === "recurring_event_expanded"));
  assert.equal(parsed.expectedTotal, undefined);
});
