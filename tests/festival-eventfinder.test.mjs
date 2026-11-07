import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseApi } from "../src/worker.mjs";
const configs = await registry();
const config = configs.find((c) => c.id === "url-004");
const body = await readFile(
  new URL("fixtures/eventfinder-search.json", import.meta.url),
  "utf8",
);
const url =
  "https://www.eventfinder.site/api/getEvents?startDateFrom=2026-11-05&page=2&limit=250";
const task = (page = 2) => ({
  kind: "api",
  meta: {
    request: {
      method: "POST",
      body: {
        filters: { startDateFrom: "2026-11-05" },
        page,
        limit: 250,
        sortBy: "StartDate",
        sortDirection: "ASC",
      },
    },
  },
});

test("Eventfinder pages queue the next POST body and keep only calendar days", () => {
  const parsed = parseApi(body, url, config, task());
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.coverage, "api-query");
  assert.equal(parsed.terminal, false);
  // The moving catalogue is never given a fixed expected total.
  assert.equal(parsed.expectedTotal, undefined);
  const [next] = parsed.nextRequests;
  assert.equal(new URL(next.url).searchParams.get("page"), "3");
  assert.equal(next.meta.request.method, "POST");
  assert.equal(next.meta.request.body.page, 3);
  assert.deepEqual(next.meta.request.body.filters, {
    startDateFrom: "2026-11-05",
  });
  for (const record of parsed.records) {
    assert.match(record.url, /^https:\/\/www\.eventfinder\.site\/event\/\d+/);
    assert.equal(record.startLocal, null);
    assert.equal(record.endLocal, null);
  }
  const timed = parsed.records.find((r) => /T\d\d:/.test(r.raw.startDate));
  assert.ok(timed);
  assert.match(timed.startDate, /^\d{4}-\d\d-\d\d$/);
});

test("Eventfinder virtual events carry no place and are flagged", () => {
  const parsed = parseApi(body, url, config, task());
  const virtual = parsed.records.find((r) => r.raw.isVirtual);
  assert.ok(virtual);
  assert.equal(virtual.location, null);
  assert.equal(virtual.geoCoordinates, null);
  assert.ok(virtual.warnings.includes("virtual_location_present"));
});

test("Eventfinder stops on the last page and rejects a page it did not request", () => {
  const data = JSON.parse(body);
  data.pagination.page = 187;
  const last = parseApi(JSON.stringify(data), url, config, task(187));
  assert.equal(last.terminal, true);
  assert.equal(last.nextRequests.length, 0);
  assert.throws(
    () => parseApi(body, url, config, task(5)),
    (e) => e.code === "pagination_changed",
  );
  assert.throws(() => parseApi("{}", url, config, task()), /pagination/);
  assert.throws(() => parseApi("<html>", url, config, task()), /non-JSON/);
  const blank = JSON.parse(body);
  blank.events[0].title = "  ";
  const withBlank = parseApi(JSON.stringify(blank), url, config, task());
  assert.equal(withBlank.records.length, 2);
  assert.equal(withBlank.rejected, 1);
  assert.ok(
    withBlank.issues.some((i) => i.code === "records_require_parse_review"),
  );
  data.events[0].eventId = null;
  assert.throws(
    () =>
      parseApi(
        JSON.stringify({
          ...data,
          pagination: { ...data.pagination, page: 2 },
        }),
        url,
        config,
        task(),
      ),
    /identity/,
  );
});
