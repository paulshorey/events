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
  if (p.mode === "drupal-pager") {
    // Drupal views pager (?page=N, zero-based) as observed on washington.org:
    // exactly one pager, one active item that agrees with the requested page,
    // and a rel=next link on every page except the last. A missing active item
    // or a disagreement is a contract failure, never an end of listing.
    const root = $("nav.pager .pager__items");
    if (root.length !== 1) fail("Drupal pager contract missing");
    const active = root.find(".pager__item.is-active");
    const current = Number(
      active
        .text()
        .trim()
        .match(/(\d+)$/)?.[1],
    );
    const requested =
      Number(new URL(url).searchParams.get(p.parameter ?? "page") ?? 0) + 1;
    if (
      active.length !== 1 ||
      !Number.isInteger(current) ||
      current !== requested
    )
      fail(`Drupal pager requested page ${requested}, active ${current}`);
    if (current > p.maxPages)
      fail("Drupal pager exceeds inspected safety bound");
    const next = root.find(".pager__item--next a[rel=next]");
    const terminal = next.length === 0;
    const nextUrl = new URL(url);
    nextUrl.searchParams.set(p.parameter ?? "page", String(current));
    return {
      terminal,
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
      currentPage: current,
    };
  }
  if (p.mode === "festivalindex-explore") {
    // FestivalIndex /explore renders "Page N / M" and "<total> events"; a request
    // beyond the last page returns no pager. Requested page, displayed page and
    // card count must agree before the next page is derived.
    const info = $(".lh-explore-page-info")
        .text()
        .match(/Page\s+(\d+)\s*\/\s*(\d+)/i),
      cards = $("[data-event-payload]").length,
      totalText = $("body")
        .text()
        .match(/\b([\d,]+)\s+events\b/i);
    if (!info) fail("FestivalIndex page-count contract missing");
    const current = Number(info[1]),
      total = Number(info[2]),
      requested = Number(new URL(url).searchParams.get("page") ?? 1);
    if (
      current !== requested ||
      current < 1 ||
      current > total ||
      total > p.maxPages ||
      !cards ||
      (current < total && cards !== (p.pageSize ?? 12))
    )
      fail("FestivalIndex page count/request disagreement");
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("page", String(current + 1));
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
      ...(totalText
        ? { expectedTotal: Number(totalText[1].replace(/,/g, "")) }
        : {}),
    };
  }
  if (p.mode === "itemlist-total") {
    // A single-page directory whose CollectionPage ItemList declares
    // numberOfItems. The list is complete only when that declaration, the
    // list length and the unique item URLs all agree; every item becomes a
    // detail request, so dated records come from the item pages.
    let list = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text()),
          candidate = data?.mainEntity;
        if (
          data?.["@type"] === "CollectionPage" &&
          candidate?.["@type"] === "ItemList"
        )
          list = candidate;
      } catch {}
    });
    if (!list || !Array.isArray(list.itemListElement))
      fail("ItemList directory contract missing");
    const urls = [
      ...new Set(
        list.itemListElement
          .map((item) => {
            try {
              return new URL(item.url, url).href;
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      ),
    ];
    const declared = Number(list.numberOfItems);
    if (
      !Number.isInteger(declared) ||
      declared !== list.itemListElement.length ||
      declared !== urls.length ||
      declared > p.maxItems
    )
      fail("ItemList declared count, list length and unique URLs disagree");
    return {
      terminal: true,
      nextRequests: urls.map((itemUrl) => ({
        url: itemUrl,
        kind: "detail",
        depth: task.depth + 1,
        meta: { discoveredOn: url, fromItemList: true },
      })),
      coverage: "verified-list",
      expectedTotal: declared,
    };
  }
  if (p.mode === "festivalnet-list") {
    // FestivalNet state lists: "?page=N", an active-page marker and a ">" arrow
    // in li.prevNext. The last page has no arrow; a request past the end shows
    // no active page. A list without any pager is a single page only when the
    // listing container itself is present.
    if (!$(p.listSelector).length) fail("FestivalNet listing contract missing");
    const requested = Number(new URL(url).searchParams.get("page") ?? 1),
      pager = $(".pagination-section");
    let terminal = true,
      nextPage = null;
    if (pager.length) {
      const active = pager.find("li.active a"),
        current = Number(active.text().trim());
      if (active.length !== 1 || current !== requested)
        fail(`FestivalNet requested page ${requested}, received ${current}`);
      if (current >= p.maxPages) fail("FestivalNet page safety bound exceeded");
      const arrow = pager
        .find("li.prevNext a")
        .filter((_, a) => $(a).text().trim() === ">");
      if (arrow.length > 1) fail("FestivalNet ambiguous next-page control");
      // Results list confirmed dates first; later pages carry only events
      // whose dates the promoter has not updated, which have no start date to
      // record. A page without a dated card ends the dated catalogue.
      if (arrow.length === 1 && $(p.cardSelector).length) {
        terminal = false;
        nextPage = current + 1;
      }
    } else if (requested !== 1) fail("FestivalNet pager missing past page 1");
    const nextUrl = new URL(url);
    if (nextPage) nextUrl.searchParams.set("page", String(nextPage));
    return {
      terminal,
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
      currentPage: requested,
    };
  }
  if (p.mode === "page-query-links") {
    // Numbered "?page=N" lists whose pager exposes only neighbouring pages.
    // The next page exists when the current page links to exactly page N+1 on
    // the same path; the last page links only backwards. A page with no
    // parsed events cannot be followed.
    const requested = Number(new URL(url).searchParams.get(p.parameter) ?? 1),
      here = new URL(url);
    if (!Number.isInteger(requested) || requested < 1)
      fail("Invalid requested page number");
    const linked = new Set();
    $("a[href],link[rel=next][href],link[rel=prev][href]").each((_, a) => {
      try {
        const u = new URL($(a).attr("href"), url);
        if (u.origin === here.origin && u.pathname === here.pathname) {
          const n = Number(u.searchParams.get(p.parameter));
          if (Number.isInteger(n) && n > 0) linked.add(n);
        }
      } catch {}
    });
    if (requested > 1 && !linked.has(requested - 1))
      fail(`Page ${requested} does not link back to page ${requested - 1}`);
    if (requested >= p.maxPages) fail("Page safety bound exceeded");
    const terminal = !linked.has(requested + 1),
      nextUrl = new URL(url);
    nextUrl.searchParams.set(p.parameter, String(requested + 1));
    return {
      terminal,
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
      currentPage: requested,
    };
  }
  fail("Unsupported inspected pagination mode");
}
