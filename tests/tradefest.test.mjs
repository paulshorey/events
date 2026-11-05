import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const html = await readFile(
  new URL("fixtures/tradefest-search-page.html", import.meta.url),
  "utf8",
);
const at = "https://tradefest.io/en/search?page=2";
// The query arguments live inside a JSON string, so their quotes are escaped.
const offset = (h, from, to) =>
  h.replace(`\\"offset\\":${from}`, `\\"offset\\":${to}`);
const total = (h, to) => h.replace('"totalCount": 8', `"totalCount": ${to}`);

test("Tradefest search pages parse the embedded events query and follow ?page=N", () => {
  const c = configs.find((c) => c.id === "url-012");
  const page = parseDocument({ html, url: at, config: c });
  assert.equal(page.records.length, 3);
  assert.equal(page.rejected, 0);
  assert.equal(page.coverage, "verified-list");
  assert.equal(page.terminal, false);
  assert.equal(page.expectedTotal, 8);
  assert.deepEqual(
    page.nextRequests.map((r) => r.url),
    ["https://tradefest.io/en/search?page=3"],
  );
  for (const r of page.records) {
    assert.match(r.url, /^https:\/\/tradefest\.io\/en\/event\/[a-z0-9-]+$/);
    assert.match(r.startDate, /^\d{4}-\d\d-\d\d$/);
    assert.equal(r.startLocal, null);
    assert.ok(r.location.venue);
    assert.ok(r.location.locality);
    assert.ok(r.location.country);
    assert.ok(r.categoryTags.length);
    assert.ok(r.raw.officialUrl);
  }
  // The final page carries no further request.
  const last = parseDocument({
    html: total(offset(html, 3, 6), 9),
    url: "https://tradefest.io/en/search?page=3",
    config: c,
  });
  assert.equal(last.terminal, true);
  assert.deepEqual(last.nextRequests, []);
});

test("Tradefest pages fail closed when the page, offset or counts disagree", () => {
  const c = configs.find((c) => c.id === "url-012");
  const fails = (h, url = at, code = "pagination_changed") =>
    assert.throws(
      () => parseDocument({ html: h, url, config: c }),
      (e) => e.code === code,
    );
  fails(html, "https://tradefest.io/en/search?page=3");
  fails(html, "https://tradefest.io/en/search");
  fails(total(html, 3));
  fails(total(html, 4));
  fails(
    html.replace('<script id="__NEXT_DATA__"', '<script id="other"'),
    at,
    "contract_changed",
  );
});
