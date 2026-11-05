// Contracts inspected in rendered publisher pages. Unknown controls never imply exhaustion.
export function inspectedPagination($, url, config, task) {
  const p = config.pagination;
  if (!p) return null;
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: "pagination_changed" });
  };
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
  if (p.mode === "offset-table") {
    // thetradeshowcalendar.com: "now showing A-B out of N exhibitions" with a
    // `vPos` row offset; the Next control is a div whose onclick carries the
    // next offset. The requested offset, the displayed range, the row count and
    // the Next target must all agree, otherwise enumeration is not claimed.
    const info = $("td.bottom-nav-text").first().text();
    const match = info.match(
      /now showing\s+([\d,]+)\s*-\s*([\d,]+)\s+out of\s+([\d,]+)\s+exhibitions/i,
    );
    if (!match) fail("Offset table range/total contract missing");
    const [first, last, total] = match
      .slice(1)
      .map((v) => Number(v.replace(/,/g, "")));
    const requested = Number(new URL(url).searchParams.get(p.parameter) ?? 0);
    const rows = $("tr.row").length;
    if (
      first !== requested + 1 ||
      last < first ||
      last > total ||
      rows !== last - first + 1 ||
      total > (p.maxRows ?? 20000)
    )
      fail(
        `Offset table disagreement: requested ${requested}, showing ${first}-${last} of ${total}, rows ${rows}`,
      );
    const click = $("td.next > div[onclick]").attr("onclick") ?? "";
    const target = click.match(/location\.href='([^']+)'/)?.[1];
    const terminal = last === total;
    if (terminal && ($("td.next").length || !$("td.next-na").length))
      fail("Offset table final page still offers Next");
    let nextUrl = null;
    if (!terminal) {
      nextUrl = target ? new URL(target, url) : null;
      if (
        !nextUrl ||
        nextUrl.hostname !== new URL(url).hostname ||
        Number(nextUrl.searchParams.get(p.parameter)) !== last
      )
        fail("Offset table Next control disagrees with the displayed range");
    }
    return {
      terminal,
      expectedTotal: total,
      nextRequests: terminal
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
      currentPage: Math.ceil(first / (last - first + 1)),
    };
  }
  fail("Unsupported inspected pagination mode");
}
