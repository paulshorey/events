import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registry } from "../src/registry.mjs";
import { parseDocument } from "../src/adapters/document.mjs";
import { eventRecord } from "../src/records.mjs";
const configs = await registry();
for (const [id, name, start, end] of [
  ["024", "nyc-tourism", "2027-03-26", "2027-04-04"],
  ["079", "orlando", "2026-10-16", "2026-10-16"],
  ["080", "downtown-orlando", "2026-10-16", "2026-10-16"],
  ["082", "san-diego", "2026-10-16", "2026-10-20"],
  ["065", "sf-portal", "2026-10-19", "2026-10-22"],
  ["014", "trade-table", "2026-10-16", "2026-10-19"],
  ["042", "chicago-parks", "2026-04-25", "2026-10-31"],
  ["007", "festivalindex", "2027-04-02", "2027-04-04"],
  ["049", "dc-tourism", "2026-10-16", "2026-10-16"],
])
  test(`${name} extracts inspected card fixtures and preserves date boundaries`, async () => {
    const c = configs.find((c) => c.id === `url-${id}`),
      html = await readFile(
        new URL(`fixtures/${name}.html`, import.meta.url),
        "utf8",
      );
    const r = parseDocument({
      html,
      url: c.url,
      // These older fixtures contain cards only. Full-page navigation contracts
      // are exercised separately by collector-validation.test.mjs.
      config: {
        ...c,
        maxDepth: 0,
        pagination: undefined,
        listingContract: undefined,
      },
    });
    assert.equal(r.records.length, id === "042" ? 1 : 2);
    assert.equal(r.rejected, id === "042" ? 1 : 0);
    assert.equal(r.records[0].startDate, start);
    assert.equal(r.records[0].endDate, end);
    for (const e of r.records) {
      assert.equal(e.collectionId, c.id);
      assert.equal(e.marketCity, c.cityMarket);
      assert.equal(e.schemaVersion, 3);
    }
    assert.notEqual(r.coverage, "verified-list");
  });
test("ISO timestamps retain their separate end date and invalid explicit ends are rejected", () => {
  const c = configs[0],
    input = {
      title: "An overnight event",
      url: "https://example.com/e",
      startDate: "2026-10-16T23:00:00-04:00",
      endDate: "2026-10-17T01:00:00-04:00",
    };
  const r = eventRecord(c, input, { url: c.url });
  assert.equal(r.endDate, "2026-10-17");
  assert.equal(r.endLocal, input.endDate);
  assert.equal(
    eventRecord(
      c,
      { ...input, endDate: "2026-02-30T01:00:00Z" },
      { url: c.url },
    ),
    null,
  );
});
test("San Diego single-page calendar is verified only with observed reveal behaviour", async () => {
  const c = configs.find((c) => c.id === "url-082"),
    html = await readFile(
      new URL("fixtures/san-diego-calendar.html", import.meta.url),
      "utf8",
    );
  // What the browser probe records on the live page: clicking until the
  // control disappears reveals every item and makes no publisher request.
  const observed = (h, extra = {}) => {
    const items =
      (h.match(/class="item /g) ?? []).length +
      (h.match(/class="item"/g) ?? []).length;
    return {
      probe: "reveal",
      controls: 1,
      clicks: 1,
      itemsBefore: items,
      itemsAfter: items,
      visibleBefore: items - 1,
      visibleAfter: items,
      controlVisibleBefore: true,
      controlVisibleAfter: false,
      requests: [],
      error: null,
      ...extra,
    };
  };
  const parse = (h, interaction = observed(h)) =>
    parseDocument({
      html: h,
      url: c.url,
      config: { ...c, maxDepth: 0 },
      interaction,
    });
  const ok = parse(html);
  assert.equal(ok.records.length, 2);
  assert.equal(ok.coverage, "verified-list");
  assert.equal(ok.terminal, true);
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.excluded, { privatePlaceholders: 1 });
  assert.equal(ok.nextRequests.length, 0);
  assert.ok(!ok.records.some((r) => /private/i.test(r.title)));
  const unverified = (h, interaction) => {
    const r = parse(h, interaction === undefined ? observed(h) : interaction);
    assert.notEqual(r.coverage, "verified-list");
    assert.equal(r.terminal, false);
    assert.ok(
      r.issues.some((i) => i.code === "single_page_contract_unverified"),
    );
  };
  // No browser observation (HTTP transport, old capture): never inferred.
  unverified(html, null);
  // Any publisher request during the clicks may have loaded more rows,
  // whatever API or binding style the script used.
  unverified(
    html,
    observed(html, {
      requests: [
        { url: "https://www.visitsandiego.com/calendar/more", type: "xhr" },
      ],
    }),
  );
  unverified(
    html,
    observed(html, {
      requests: [
        { url: "https://www.visitsandiego.com/more.js", type: "script" },
      ],
    }),
  );
  // Rows appeared, stayed hidden, or the control never went away.
  unverified(html, observed(html, { itemsAfter: 4 }));
  unverified(html, observed(html, { visibleAfter: 2 }));
  unverified(html, observed(html, { controlVisibleAfter: true }));
  unverified(html, observed(html, { error: "Timeout 5000ms exceeded" }));
  // The control was gone or never used (e.g. replaced by infinite scroll).
  unverified(html, observed(html, { clicks: 0 }));
  unverified(html, observed(html, { controlVisibleBefore: false }));
  unverified(html, observed(html, { visibleBefore: 3 }));
  // Server pagination means one document is not the whole list.
  unverified(
    html.replace(
      "Load more</a>",
      'Load more</a><a rel="next" href="?page=2">2</a>',
    ),
  );
  // A navigation control the probe never exercised.
  unverified(
    html.replace(
      "Load more</a>",
      'Load more</a><button class="pagination-next">Next</button>',
    ),
  );
  unverified(
    html.replace(
      "Load more</a>",
      'Load more</a><a aria-label="Next page" href="#">›</a>',
    ),
  );
  // Paging identified only by visible text or a calendar URL.
  unverified(
    html.replace("Load more</a>", "Load more</a><button>Next</button>"),
  );
  unverified(
    html.replace(
      "Load more</a>",
      'Load more</a><a href="/calendar/page/2">Older</a>',
    ),
  );
  // Any other control inside the list container is outside the allowlist.
  unverified(
    html.replace(
      '<a href="#" class="sppb-btn loadMore">',
      '<select name="month"><option>December</option></select><a href="#" class="sppb-btn loadMore">',
    ),
  );
  // A second control would be exempted from paging checks but never clicked.
  unverified(
    html.replace(
      "Load more</a>",
      'Load more</a><a href="#" class="loadMore">Load more</a>',
    ),
  );
  unverified(html, observed(html, { controls: 2 }));
  // An event link outside every row is an event nobody parsed.
  unverified(
    html.replace(
      '<a href="#" class="sppb-btn loadMore">',
      '<a href="/calendar/999-orphan-event">Orphan</a><a href="#" class="sppb-btn loadMore">',
    ),
  );
  // An event titled like a paging word is still an event, not paging.
  const titled = html.replace(
    " ECKHART TOLLE WEEKEND INTENSIVE </a>",
    "Next</a>",
  );
  assert.equal(parse(titled).coverage, "verified-list");
  // A "Private" row carrying a public event link is not a placeholder.
  unverified(
    html.replace(
      "<span>Private</span>",
      '<span>Private</span><a href="/calendar/2209999-hidden-event">details</a>',
    ),
  );
  // A row carrying a second distinct event link would drop that event.
  unverified(
    html.replace(
      'itemprop="url">',
      'itemprop="url">Eckhart</a> <a href="/calendar/999-second-event">Second',
    ),
  );
  // An unlinked row that is not a private placeholder is unexplained.
  unverified(html.replace("<span>Private</span>", "<span>Mystery</span>"));
  // A linked row that fails to parse must not count toward the whole list.
  unverified(html.replace("<span>11/07/2026</span>", "<span>TBA</span>"));
  // A revealable item without an event row would be shown but not parsed.
  unverified(
    html.replace(
      '<a href="#" class="sppb-btn loadMore">',
      '<div class="item"><h3>Unparsed event</h3></div><a href="#" class="sppb-btn loadMore">',
    ),
  );
  // Without the registry declaration the adapter stays conservative.
  assert.equal(
    parseDocument({
      html,
      url: c.url,
      config: { ...c, maxDepth: 0, listCompleteness: undefined },
      interaction: observed(html),
    }).coverage,
    "unverified",
  );
});
