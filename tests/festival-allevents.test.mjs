import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const config = configs.find((c) => c.id === "url-002");
const html = await readFile(
  new URL("fixtures/allevents-city-list.html", import.meta.url),
  "utf8",
);
const listing = { kind: "listing", depth: 0, meta: { pagination: true } };
const url = "https://allevents.in/new-york/all?page=2";

test("AllEvents seeds city list pages and does not follow event detail pages", () => {
  assert.ok(config.entrypoints.length >= 10);
  assert.ok(
    config.entrypoints.every((e) =>
      /^https:\/\/allevents\.in\/[a-z-]+\/all$/.test(e),
    ),
  );
  assert.equal(config.enrichDetails, false);
  const parsed = parseDocument({ html, url, config, task: listing });
  assert.equal(
    parsed.nextRequests.filter((r) => r.kind === "detail").length,
    0,
  );
});

test("AllEvents list pages keep structured dates, clocks and venue address", () => {
  const parsed = parseDocument({ html, url, config, task: listing });
  assert.equal(parsed.records.length, 2);
  const [first, second] = parsed.records;
  assert.equal(first.startDate, "2026-11-05");
  assert.equal(first.location.locality, "New York");
  assert.ok(first.geoCoordinates);
  assert.equal(second.startLocal, "2026-11-06T21:00:00");
  assert.equal(second.endLocal, "2026-11-06T23:00:00");
});

test("AllEvents follows only the same list's next page and checks the back link", () => {
  const parsed = parseDocument({ html, url, config, task: listing });
  assert.equal(parsed.terminal, false);
  const next = parsed.nextRequests.filter((r) => r.kind === "listing");
  assert.equal(next.length, 1);
  assert.equal(next[0].url, "https://allevents.in/new-york/all?page=3");
  // A link to another city's page 3 does not make this list continue.
  const other = html.replace("new-york/all?page=3", "chicago/all?page=3");
  assert.equal(
    parseDocument({ html: other, url, config, task: listing }).terminal,
    true,
  );
  // Landing on a page that does not link back is a pagination change.
  assert.throws(
    () =>
      parseDocument({
        html,
        url: "https://allevents.in/new-york/all?page=7",
        config,
        task: listing,
      }),
    /does not link back/,
  );
  // The first page has no back link and needs no page parameter.
  const first = parseDocument({
    html: html.replace("all?page=1", "all?page=2"),
    url: "https://allevents.in/new-york/all",
    config,
    task: { kind: "listing", depth: 0, meta: {} },
  });
  assert.equal(first.terminal, false);
});
