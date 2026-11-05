// Contracts inspected in rendered publisher pages. Unknown controls never imply exhaustion.
export function inspectedPagination($, url, config, task) {
  const p = config.pagination;
  if (!p) return null;
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: "pagination_changed" });
  };
  // Handled by the adapter itself (its pages are plain URLs).
  if (p.mode === "nycparks-aggregate") return null;
  if (p.mode === "nyc-browser") {
    const root = $('ul[class*="SearchPagination_pagination"]');
    if (
      root.length !== 1 ||
      root.find('li[class*="SearchPagination_active"]').length !== 1
    )
      fail("NYC pagination/active-page contract missing");
    const current = Number(
        root.find('li[class*="SearchPagination_active"]').text().trim(),
      ),
      expected = task.meta?.browserPage ?? 1;
    if (current !== expected)
      fail(`NYC requested page ${expected}, received ${current}`);
    const next = root.find("li.next");
    if (next.length !== 1) fail("NYC next-page control missing");
    const terminal = next.hasClass("disabled");
    if (!terminal && current >= p.maxPages)
      fail("NYC pagination exceeds inspected page safety bound");
    const nextUrl = new URL(config.url);
    nextUrl.hash = `events-miner-page=${current + 1}`;
    return {
      terminal,
      nextRequests: terminal
        ? []
        : [
            {
              url: nextUrl.href,
              kind: "listing",
              depth: 0,
              meta: { pagination: true, browserPage: current + 1 },
            },
          ],
      coverage: "verified-list",
      currentPage: current,
    };
  }
  if (p.mode === "opencities-query") {
    const info = $(".seamless-pagination-info"),
      match = info.text().match(/Page\s+(\d+)\s+of\s+(\d+)/i),
      select = $(".seamless-pagination-data select");
    if (info.length !== 1 || !match || select.length !== 1)
      fail("OpenCities page count contract missing");
    const current = Number(match[1]),
      total = Number(match[2]),
      requestPage =
        new URL(url).searchParams
          .get(p.parameter)
          ?.match(/^\(pageindex=(\d+)\)$/)?.[1] ?? "1";
    if (
      current !== Number(requestPage) ||
      current < 1 ||
      current > total ||
      total > p.maxPages ||
      select.find("option").length !== total
    )
      fail("OpenCities page count/request disagreement");
    const nextUrl = new URL(url);
    nextUrl.searchParams.set(p.parameter, `(pageindex=${current + 1})`);
    return {
      terminal: current === total,
      nextRequests:
        current === total
          ? []
          : [
              {
                url: nextUrl.href,
                kind: "listing",
                depth: 0,
                meta: { pagination: true },
              },
            ],
      coverage: "verified-list",
      currentPage: current,
      totalPages: total,
    };
  }
  fail("Unsupported inspected pagination mode");
}
