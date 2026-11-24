import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { evaluate, optionsFor, parseApi } from "../src/worker.mjs";
import { Journal } from "../src/storage/journal.mjs";
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

test("Festival Trekker rejects changed API shapes and reconciles expanded schedules across pages", (t) => {
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
  const journal = new Journal(":memory:");
  t.after(() => journal.close());
  journal.register([config]);
  const options = optionsFor(config, { asOf: "2026-11-05" }, "test-build");
  const { runId } = journal.enqueue(config.id, options);
  const { token } = journal.claim("test", 60_000, runId);
  const totals = { total: 2, totalPages: 2 };
  const firstPage = journal.nextPage(runId, token);
  const first = parseApi(
    JSON.stringify([events[1]]),
    firstPage.url,
    config,
    firstPage,
    totals,
  );
  journal.commitPage(runId, token, firstPage, first, {
    path: "first",
    hash: "first",
  });
  const secondPage = journal.nextPage(runId, token);
  const second = parseApi(
    JSON.stringify(recurring),
    secondPage.url,
    config,
    secondPage,
    totals,
  );
  journal.commitPage(runId, token, secondPage, second, {
    path: "second",
    hash: "second",
  });
  assert.equal(second.records.length, 2);
  assert.equal(second.records[1].endLocal, "2026-11-12T21:00:00");
  assert.equal(second.expectedTotal, 2);
  assert.equal(second.recurringExpanded, 1);
  assert.deepEqual(second.issues, []);
  const result = evaluate(journal, journal.run(runId));
  assert.equal(result.observedRecords, 3);
  assert.equal(result.observedSourceItems, 2);
  assert.equal(result.complete, true);
});
