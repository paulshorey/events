import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();

test("TSNN's embedded table keeps its combined venue/location cell and both dates", async () => {
  const c = configs.find((c) => c.id === "url-010");
  const html = await readFile(
    new URL("fixtures/tsnn-embed-page.html", import.meta.url),
    "utf8",
  );
  const page = parseDocument({
    html,
    url: "https://thetradeshowcalendar.com/tsnn/",
    config: c,
  });
  assert.equal(page.records.length, 2);
  assert.equal(page.expectedTotal, 4);
  assert.equal(page.terminal, false);
  const sema = page.records.find((r) => r.title === "SEMA Show");
  assert.equal(sema.startDate, "2026-11-03");
  assert.equal(sema.endDate, "2026-11-06");
  assert.equal(
    sema.location.formattedAddress,
    "Las Vegas Convention Center Las Vegas, NV, United States",
  );
  assert.equal(sema.location.venue, null);
  assert.equal(sema.location.locality, null);
  assert.equal(sema.location.region, "NV");
  assert.equal(sema.location.country, "US");
  assert.equal(new URL(page.nextRequests[0].url).searchParams.get("vPos"), "2");
});

test("Trade Show Calendar offset pages must agree on range, rows, total and the Next target", async () => {
  const c = configs.find((c) => c.id === "url-014");
  const html = await readFile(
    new URL("fixtures/trade-table-page.html", import.meta.url),
    "utf8",
  );
  const at = "https://thetradeshowcalendar.com/ttn/index.php?vRpP=100&vPos=100";
  const parse = (h, url = at) => parseDocument({ html: h, url, config: c });
  const page = parse(html);
  assert.equal(page.records.length, 2);
  assert.equal(page.coverage, "verified-list");
  assert.equal(page.terminal, false);
  assert.equal(page.expectedTotal, 202);
  assert.deepEqual(
    page.nextRequests.map((r) => [
      r.kind,
      new URL(r.url).searchParams.get("vPos"),
    ]),
    [["listing", "102"]],
  );
  const miami = page.records.find((r) => r.title.includes("Jewelers"));
  assert.equal(miami.location.locality, "Miami");
  assert.equal(miami.location.region, "FL");
  // Two rows sharing one organizer website and date (listed under two names,
  // as in the captured NSGC/Hostex rows) remain two observations.
  const shared = parse(
    html
      .replace(
        "https://www.jisshow.com/fall/en-us.html",
        "https://www.euromineexpo.com",
      )
      .replace("OCT/16 - OCT/19/2026", "MAY/30 - JUN/01/2028"),
  );
  assert.equal(shared.records.length, 2);
  assert.equal(new Set(shared.records.map((r) => r.sourceRecordId)).size, 2);
  const last = parse(
    html
      .replace("101-102 out of 202", "101-102 out of 102")
      .replace(
        /<td class="next">.*?<\/td>/s,
        '<td class="next-na"><div>&nbsp;</div></td>',
      ),
  );
  assert.equal(last.terminal, true);
  assert.deepEqual(last.nextRequests, []);
  // Each disagreement fails closed rather than claiming enumeration.
  const fails = (h, url) =>
    assert.throws(
      () => parse(h, url),
      (e) => e.code === "pagination_changed",
    );
  fails(html, "https://thetradeshowcalendar.com/ttn/index.php?vPos=0");
  fails(html.replace("101-102", "101-103"));
  fails(html.replace("vPos=102", "vPos=200"));
  fails(html.replace("101-102 out of 202 exhibitions", "unavailable"));
  fails(html.replace(/<tr class="even row">.*?<\/tr>/s, ""));
  fails(html.replace(/<td class="next">.*?<\/td>/s, ""));
  fails(html.replace("101-102 out of 202", "101-102 out of 102"));
});
