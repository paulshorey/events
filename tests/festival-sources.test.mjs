import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
const configs = await registry();
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");

test("FestivalIndex explore pages enumerate by reconciled page counter and declared total", async () => {
  const config = {
      ...configs.find((c) => c.id === "url-007"),
      pagination: { mode: "festivalindex-explore", maxPages: 40, pageSize: 2 },
    },
    html = await fixture("festivalindex-explore"),
    url = "https://festivalindex.com/en-us/explore?page=2";
  const parsed = parseDocument({ html, url, config });
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.expectedTotal, 190);
  assert.equal(parsed.terminal, false);
  assert.equal(parsed.coverage, "verified-list");
  const next = parsed.nextRequests.filter((r) => r.kind === "listing");
  assert.equal(next.length, 1);
  assert.equal(new URL(next[0].url).searchParams.get("page"), "3");
  // Cards are never followed to detail pages for this source.
  assert.equal(
    parsed.nextRequests.filter((r) => r.kind === "detail").length,
    0,
  );
  // The displayed page must equal the requested page.
  assert.throws(
    () =>
      parseDocument({
        html,
        url: "https://festivalindex.com/en-us/explore?page=3",
        config,
      }),
    /disagreement/,
  );
  // A final page is terminal and may hold fewer cards than a full page.
  const last = html.replace("Page 2 / 16", "Page 16 / 16");
  const done = parseDocument({
    html: last,
    url: "https://festivalindex.com/en-us/explore?page=16",
    config: { ...config, pagination: { ...config.pagination, pageSize: 12 } },
  });
  assert.equal(done.terminal, true);
  assert.equal(done.nextRequests.length, 0);
  // A missing pager is a contract change, not an empty catalogue.
  assert.throws(
    () =>
      parseDocument({
        html: html.replace(/Page 2 \/ 16/, ""),
        url,
        config,
      }),
    /contract missing/,
  );
});
