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
const window = (h, min, max) =>
  h
    .replace('\\"minDate\\":\\"2026-11-01\\"', `\\"minDate\\":\\"${min}\\"`)
    .replace('\\"maxDate\\":null', `\\"maxDate\\":\\"${max}\\"`);

test("Tradefest tag pages parse the embedded events query and follow ?page=N", () => {
  const c = configs.find((c) => c.id === "url-083");
  assert.ok(!c.windowedSearch);
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
  const c = configs.find((c) => c.id === "url-083");
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

test("the Tradefest directory is read as start-date windows because rating order is unstable", () => {
  // Disabled for url-012: the filter keeps only events wholly inside a window,
  // so splitting a window loses events that cross the split.
  const c = {
    ...configs.find((c) => c.id === "url-012"),
    windowedSearch: true,
  };
  const root = parseDocument({
    html: offset(html, 3, 0),
    url: "https://tradefest.io/en/search",
    config: c,
  });
  assert.equal(root.expectedTotal, 8);
  assert.equal(root.terminal, true);
  const months = root.nextRequests.map((r) => new URL(r.url).searchParams);
  assert.equal(months.length, 62);
  assert.equal(months[0].get("minDate"), "2026-11-01");
  assert.equal(months[0].get("maxDate"), "2026-11-30");
  assert.equal(months.at(-1).get("minDate"), "2031-12-01");
  assert.equal(months.at(-1).get("maxDate"), "2031-12-31");
  // A window holding more than a page is split in two, without a total claim.
  const wide = parseDocument({
    html: offset(window(html, "2027-03-01", "2028-04-30"), 3, 0),
    url: "https://tradefest.io/en/search?minDate=2027-03-01&maxDate=2028-04-30",
    config: c,
  });
  assert.equal(wide.expectedTotal, undefined);
  assert.deepEqual(
    wide.nextRequests.map((r) => [
      new URL(r.url).searchParams.get("minDate"),
      new URL(r.url).searchParams.get("maxDate"),
    ]),
    [
      ["2027-03-01", "2027-09-30"],
      ["2027-10-01", "2028-04-30"],
    ],
  );
  // A window that fits one page ends there.
  const small = parseDocument({
    html: total(offset(window(html, "2027-03-01", "2028-04-30"), 3, 0), 3),
    url: "https://tradefest.io/en/search?minDate=2027-03-01&maxDate=2028-04-30",
    config: c,
  });
  assert.deepEqual(small.nextRequests, []);
  assert.equal(small.records.length, 3);
  // A single day larger than a page is paged.
  const day = parseDocument({
    html: offset(
      window(html, "2027-06-10", "2027-06-10")
        .replace('"startDate": "2028-04-02"', '"startDate": "2027-06-10"')
        .replace('"startDate": "2027-03-18"', '"startDate": "2027-06-10"'),
      3,
      0,
    ),
    url: "https://tradefest.io/en/search?minDate=2027-06-10&maxDate=2027-06-10",
    config: c,
  });
  assert.equal(day.nextRequests.length, 1);
  assert.equal(new URL(day.nextRequests[0].url).searchParams.get("page"), "2");
  // Events outside the requested bounds, or a window the page ignores, fail.
  assert.throws(
    () =>
      parseDocument({
        html: offset(window(html, "2027-03-01", "2027-03-31"), 3, 0),
        url: "https://tradefest.io/en/search?minDate=2027-03-01&maxDate=2027-03-31",
        config: c,
      }),
    (e) => e.code === "pagination_changed",
  );
  assert.throws(
    () =>
      parseDocument({
        html: offset(html, 3, 0),
        url: "https://tradefest.io/en/search?minDate=2027-03-01&maxDate=2028-04-30",
        config: c,
      }),
    (e) => e.code === "pagination_changed",
  );
});

test("a window the upstream count proves empty is a verified empty page, not a missing contract", () => {
  const c = {
    ...configs.find((c) => c.id === "url-012"),
    windowedSearch: true,
  };
  const match = html.match(
    /(<script id="__NEXT_DATA__" type="application\/json">)(.*)(<\/script>)/s,
  );
  const data = JSON.parse(match[2]);
  const cache = data.props.pageProps.props.__APOLLO_STATE__;
  const key = Object.keys(cache.ROOT_QUERY).find((k) =>
    k.startsWith("events("),
  );
  cache.ROOT_QUERY[key].nodes = [];
  cache.ROOT_QUERY[key].totalCount = 0;
  const empty = html.replace(
    match[0],
    match[1] + JSON.stringify(data) + match[3],
  );
  const page = parseDocument({
    html: offset(window(empty, "2031-01-01", "2031-01-31"), 3, 0),
    url: "https://tradefest.io/en/search?minDate=2031-01-01&maxDate=2031-01-31",
    config: c,
  });
  assert.equal(page.records.length, 0);
  assert.equal(page.terminal, true);
  assert.deepEqual(page.issues, []);
});
