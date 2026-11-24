import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { evaluate, parseApi } from "../src/worker.mjs";
const configs = await registry();
const config = configs.find((c) => c.id === "url-008");
const body = await readFile(
  new URL("fixtures/countyfairgrounds-state.json", import.meta.url),
  "utf8",
);
const url =
  "https://www.countyfairgrounds.net/ajax/ajax_state.php?state=AL&eventtype=all";

test("Countyfairgrounds registers one JSON request per state with the observed endpoint", () => {
  assert.equal(config.entrypoints.length, 50);
  assert.equal(new Set(config.entrypoints.map((e) => e.url)).size, 50);
  for (const entry of config.entrypoints) {
    assert.equal(entry.kind, "api");
    assert.match(
      entry.url,
      /\/ajax\/ajax_state\.php\?state=[A-Z]{2}&eventtype=all$/,
    );
  }
});

test("Countyfairgrounds state events keep source dates, place fields and a stable source link", () => {
  const parsed = parseApi(body, url, config, { kind: "api" });
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.coverage, "api-query");
  assert.equal(parsed.nextRequests.length, 0);
  const [first] = parsed.records;
  assert.equal(first.title, "Greater Gulf State Fair");
  assert.equal(first.startDate, "2026-10-30");
  assert.equal(first.endDate, "2026-11-08");
  assert.equal(first.sourceRecordId, "2027");
  assert.equal(
    first.url,
    "https://www.countyfairgrounds.net/state.php?state=AL#event-2027",
  );
  assert.equal(first.location.locality, "Mobile");
  assert.equal(first.location.region, "AL");
  assert.equal(first.startLocal, null);
  assert.equal(first.raw.website, "https://www.greatergulfstatefair.com/");
  assert.deepEqual(
    first.categoryTags.map((t) => t.label),
    ["State Fair"],
  );
});

test("Countyfairgrounds flags rejected rows and refuses a changed contract", () => {
  const events = JSON.parse(body);
  events[1].EndDate = "2026-01-01";
  const parsed = parseApi(JSON.stringify(events), url, config, {});
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.rejected, 1);
  assert.ok(
    parsed.issues.some((i) => i.code === "records_require_parse_review"),
  );
  assert.deepEqual(parseApi("[]", url, config, {}).records, []);
  assert.throws(() => parseApi("<html>", url, config, {}), /non-JSON/);
  assert.throws(() => parseApi("{}", url, config, {}), /event array/);
  assert.throws(
    () => parseApi(JSON.stringify([{ EventNum: 1 }]), url, config, {}),
    /identity or dates/,
  );
  assert.throws(
    () =>
      parseApi(
        body,
        "https://www.countyfairgrounds.net/ajax/ajax_state.php?eventtype=all",
        config,
        {},
      ),
    /state parameter/,
  );
});

test("an uncorroborated empty state leaves the national catalogue partial", () => {
  const pages = config.entrypoints.map((entry, index) => ({
    kind: "api",
    state: "done",
    result: parseApi(index === 0 ? "[]" : body, entry.url, config, {}),
  }));
  const records = pages[1].result.records;
  const result = evaluate(
    { pages: () => pages, records: () => records, collection: () => ({}) },
    { config, options: { asOf: "2026-10-30", transport: "api" } },
  );
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.issues, [{
    code: "unverified_empty_state",
    state: new URL(config.entrypoints[0].url).searchParams.get("state"),
  }]);
});
