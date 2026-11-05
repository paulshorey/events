// Additional contracts derived from captured publisher HTML, not guessed from platform names.
import { load } from "cheerio";
import { dates, eventRecord, safeUrl, text } from "../records.mjs";
export const inspectedAdapters = new Set([
  "conventiongrid",
  "conventioncalendar",
  "tradefest",
  "nyc-tourism",
  "opencities",
  "san-diego",
  "sf-portal",
  "trade-table",
  "chicago-parks",
  "discover-la",
]);
// Any navigation-like control other than the probed reveal control: the probe
// never exercises it, so its presence means the document may not be the list.
// Allowlist inside the list (the one container holding every item may contain
// only event-detail links); page-wide, any control that looks like paging by
// class, rel, label, visible text or a non-event /calendar URL counts.
const EVENT_PATH = /^\/calendar\/\d+-[^/?#]+$/;
const PAGING_TEXT =
  /^(next|next page|older|newer|previous|prev|more|more events|show more|view more|see more|load more|[›»>]+|\d{1,3})$/i;
function otherPagingControls($, url) {
  const token =
    /^(pagination|pager|paging|next|nav-next|page-next|load-?more|show-?more|view-?more|infinite)/i;
  const containers = new Set(
    $(".calendar .item")
      .map((_, e) => e.parent)
      .get(),
  );
  const listControls =
    containers.size !== 1
      ? [null]
      : $([...containers][0])
          .find(
            "a, button, form, input, select, textarea, [role=button], [onclick]",
          )
          .filter((_, e) => {
            const el = $(e);
            if (el.is(".calendar .loadMore")) return false;
            const href = el.attr("href") ?? "";
            if (!EVENT_PATH.test(href)) return true;
            // An event link must belong to a row whose heading is that event;
            // an orphan link would be an event nobody parsed.
            const heading = el.closest(".calendar .item").find("h2 a");
            return heading.length !== 1 || heading.attr("href") !== href;
          })
          .toArray();
  const pathOf = (value) => {
    try {
      return new URL(value, url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return null;
    }
  };
  const pageControls = $("body *")
    .filter((_, e) => {
      const el = $(e);
      if (el.is(".calendar .loadMore")) return false;
      if ((el.attr("rel") ?? "").split(/\s+/).includes("next")) return true;
      if (/\b(next|more)\b/i.test(el.attr("aria-label") ?? "")) return true;
      const target = el.is("a")
        ? el.attr("href")
        : el.is("form")
          ? el.attr("action")
          : null;
      if (target != null) {
        if (/[?&](page|start|limitstart|offset)=/i.test(target)) return true;
        const path = pathOf(target);
        if (
          path?.startsWith("/calendar") &&
          path !== "/calendar" &&
          !EVENT_PATH.test(path)
        )
          return true;
        // An event link anywhere on the page must be the heading of an
        // accounted row; then it is not paging, whatever its title says.
        if (el.is("a") && path && EVENT_PATH.test(path)) {
          const heading = el.closest(".calendar .item").find("h2 a");
          return !(
            heading.length === 1 && pathOf(heading.attr("href") ?? "") === path
          );
        }
      }
      if (
        el.is(
          "a, button, [role=button], input[type=submit], input[type=button]",
        ) &&
        PAGING_TEXT.test(text(el.text() || el.attr("value") || "") ?? "")
      )
        return true;
      return (el.attr("class") ?? "").split(/\s+/).some((c) => token.test(c));
    })
    .toArray();
  return [...listControls, ...pageControls];
}

export function parseInspected({ html, url, config, interaction }) {
  const $ = load(html),
    records = [],
    issues = [],
    nextRequests = [];
  let count = 0,
    rejected = 0,
    coverage = "unverified",
    expectedTotal,
    terminal = false;
  const excluded = {};
  const add = (input, selector) => {
    count++;
    const r = eventRecord(config, input, { url, selector });
    if (r) records.push(r);
    else rejected++;
  };
  if (config.adapter === "conventiongrid") {
    // Inspected November 5, 2026: /calendar/ server-renders every upcoming show
    // once, grouped under "<Month> <Year>" headings. Cards show "Mon D - Mon D"
    // without a year; the year comes from the heading of the start month, and
    // the end rolls into the next year only when its month precedes the start.
    const MONTHS = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthIndex = (label) =>
      MONTHS.indexOf(label.slice(0, 3).toLowerCase());
    let cards = 0,
      mismatched = 0;
    $("h3").each((_, h) => {
      const heading = text($(h).text()).match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (!heading || monthIndex(heading[1]) < 0) return;
      const year = Number(heading[2]),
        groupMonth = monthIndex(heading[1]);
      $(h)
        .next()
        .children('a[href^="/shows/"]')
        .each((_, el) => {
          cards++;
          const c = $(el),
            spans = c.find("span"),
            range = text(spans.first().text()).match(
              /^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*-\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})$/,
            );
          const startMonth = range ? monthIndex(range[1]) : -1,
            endMonth = range ? monthIndex(range[3]) : -1;
          if (!range || startMonth < 0 || endMonth < 0) {
            rejected++;
            return;
          }
          if (startMonth !== groupMonth) mismatched++;
          const endYear = endMonth < startMonth ? year + 1 : year,
            iso = (y, m, d) =>
              `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const place = text(spans.eq(2).text()).match(/^(.*?)\s*,\s*([^,]+)$/);
          count++;
          const r = eventRecord(
            config,
            {
              title: c.find("h4").first().text(),
              url: c.attr("href"),
              startDate: iso(year, startMonth, Number(range[2])),
              endDate: iso(endYear, endMonth, Number(range[4])),
              dateTimeBasis: {
                start: "visible listing month/day with month-heading year",
                end: "visible listing month/day with month-heading year",
              },
              location: {
                locality: place?.[1],
                country: place?.[2],
                basis: "upstream card city and country; venue on detail page",
              },
              categoryTags: c
                .find(".flex-wrap span")
                .map((_, e) => ({
                  label: text($(e).text()),
                  basis: "upstream card tag",
                }))
                .get(),
              raw: {
                date: text(spans.first().text()),
                heading: text($(h).text()),
              },
            },
            { url, selector: "h3 + div > a[href^=/shows/]" },
          );
          if (r) records.push(r);
          else rejected++;
        });
    });
    // The page states its own total and per-month counts; completeness is
    // claimed only when every card is accounted for against both.
    const stated = Number(
      ($("title,meta[name=description]")
        .toArray()
        .map((e) => $(e).attr("content") ?? $(e).text())
        .join(" ")
        .match(/([\d,]+)\s+upcoming/) ?? [])[1]?.replace(/,/g, ""),
    );
    const monthTotal = $('a[href^="/calendar/"]')
      .map((_, e) =>
        /^\/calendar\/\d{4}\/[a-z]+\/$/.test($(e).attr("href"))
          ? Number(text($(e).text()).match(/\((\d+)\)\s*$/)?.[1] ?? NaN)
          : NaN,
      )
      .get()
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0);
    const unique = new Set(records.map((r) => r.sourceRecordId)).size;
    if (
      cards &&
      !rejected &&
      !mismatched &&
      unique === cards &&
      cards === stated &&
      cards === monthTotal
    ) {
      coverage = "verified-list";
      terminal = true;
    } else
      issues.push({
        code: "single_page_contract_unverified",
        cards,
        stated,
        monthTotal,
        unique,
        mismatched,
      });
  } else if (config.adapter === "tradefest") {
    // Inspected November 5, 2026: tradefest.io is a Next.js site whose pages
    // embed the Apollo cache of the server-rendered GraphQL `events(...)` query
    // (30 per page, `?page=N`, with a `totalCount`). Event dates are exact
    // calendar days; venue and city/country come from linked cache objects.
    let cache;
    try {
      cache = JSON.parse($("script#__NEXT_DATA__").text()).props.pageProps.props
        .__APOLLO_STATE__;
    } catch {
      cache = null;
    }
    const queries = cache
      ? Object.entries(cache.ROOT_QUERY ?? {}).filter(([key]) =>
          key.startsWith("events("),
        )
      : [];
    if (queries.length !== 1)
      throw Object.assign(
        new Error("Tradefest events query/cache contract missing"),
        { code: "contract_changed" },
      );
    const [queryKey, query] = queries[0];
    const args = JSON.parse(queryKey.slice("events(".length, -1));
    const { limit, offset } = args.pagination ?? {};
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    const total = query.totalCount;
    const ref = (value) => (value?.__ref ? cache[value.__ref] : value);
    const nodes = (query.nodes ?? []).map(ref);
    if (
      !Number.isInteger(limit) ||
      !Number.isInteger(offset) ||
      !Number.isInteger(total) ||
      offset !== (page - 1) * limit ||
      nodes.length !== Math.min(limit, Math.max(total - offset, 0)) ||
      nodes.some((n) => n?.__typename !== "Event")
    )
      throw Object.assign(
        new Error(
          `Tradefest page/offset/count disagreement: page ${page}, offset ${offset}, limit ${limit}, ${nodes.length} of ${total}`,
        ),
        { code: "pagination_changed" },
      );
    for (const node of nodes) {
      const venue = ref(node.venue),
        place = ref(venue?.location);
      count++;
      const base = new URL(url);
      const r = eventRecord(
        config,
        {
          id: `${node.id}|${node.startDate}`,
          title: node.name,
          url: `${base.origin}/${base.pathname.split("/")[1]}/event/${node.slug}`,
          startDate: node.startDate,
          endDate: node.endDate,
          dateTimeBasis: {
            start: "upstream event startDate (calendar day)",
            end: "upstream event endDate (calendar day)",
          },
          location: {
            venue: venue?.name,
            locality: place?.localizedCity,
            country: place?.localizedCountry,
            basis: "upstream event venue and location",
          },
          categoryTags: (node.tags ?? [])
            .map(ref)
            .filter((tag) => tag?.localizedName)
            .map((tag) => ({
              label: tag.localizedName,
              slug: tag.localizedSlug,
              basis: "upstream industry tag",
            })),
          raw: {
            id: node.id,
            slug: node.slug,
            officialUrl: node.url,
            filters: args.filters,
            orderBy: args.orderBy,
            page,
          },
        },
        { url, selector: "__NEXT_DATA__ Apollo events query" },
      );
      if (r) records.push(r);
      else rejected++;
    }
    const shown = offset + nodes.length;
    terminal = shown >= total;
    coverage = "verified-list";
    if (!terminal) {
      const next = new URL(url);
      next.hash = "";
      next.searchParams.set("page", String(page + 1));
      nextRequests.push({
        url: next.href,
        kind: "listing",
        depth: 0,
        meta: { pagination: true },
      });
    }
    expectedTotal = total;
  } else if (config.adapter === "conventioncalendar") {
    // Inspected November 5, 2026. conventioncalendar.com serves destinations
    // (/destinations, paginated), city pages (/us/st/city) and venue pages
    // (/us/st/city/venue). City and venue pages list one month of events at a
    // time as `.entity-list-card` rows, and a month menu names every month that
    // has events (`?date=YYYY-MM-01`). Dates carry full years; the detail pages'
    // JSON-LD times are placeholders (midnight/23:59 with an unrelated offset),
    // so only the listing's calendar days are used.
    const MONTHS = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const here = new URL(url);
    const place = here.pathname.split("/").filter(Boolean);
    const isDestinations = here.pathname.replace(/\/$/, "") === "/destinations";
    const cityPath = /^\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+$/;
    if (isDestinations) {
      // An index of cities: each city page is a listing to enumerate.
      const cities = new Set();
      $(".entity-grid-card a[href]").each((_, e) => {
        const target = new URL($(e).attr("href"), url);
        if (target.hostname === here.hostname && cityPath.test(target.pathname))
          cities.add(target.origin + target.pathname);
      });
      count += cities.size;
      if (config.followDestinations)
        for (const city of cities)
          nextRequests.push({
            url: city,
            kind: "listing",
            depth: 0,
            meta: { destination: true },
          });
      if (!cities.size)
        throw Object.assign(new Error("Destination cards missing"), {
          code: "contract_changed",
        });
      coverage = "verified-list";
      terminal = true;
    } else {
      const cards = $(".entity-list-card");
      const monthButton = text(
        $("button.dropdown-toggle:has(i.fa-calendar-check)").first().text(),
      ).match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
      const requestedMonth = here.searchParams.get("date");
      if (
        requestedMonth &&
        (!monthButton ||
          requestedMonth !==
            `${monthButton[2]}-${String(MONTHS.indexOf(monthButton[1].toLowerCase()) + 1).padStart(2, "0")}-01`)
      )
        throw Object.assign(
          new Error(
            `Convention Calendar requested ${requestedMonth}, page shows ${monthButton?.[0]}`,
          ),
          { code: "pagination_changed" },
        );
      const venueHeader = text(
        $(".entity-poster").first().parent().find(".small.mt-1").first().text(),
      )
        .split(/,\s*/)
        .filter(Boolean);
      const cityHeading = text($(".accordion-button").first().text()).split(
        /,\s*/,
      );
      cards.each((_, el) => {
        const c = $(el),
          link = c.find("h5").first().closest("a"),
          href = link.attr("href") ?? "",
          id = href.match(/-(\d+)$/)?.[1],
          range = text(c.find(".fa-calendar-check").parent().text()).match(
            /^([A-Za-z]{3}) (\d{2}) (\d{4}) - ([A-Za-z]{3}) (\d{2}) (\d{4})$/,
          );
        count++;
        const month = (label) => MONTHS.indexOf(label.toLowerCase()) + 1;
        const iso = (m, d, y) =>
          month(m) > 0
            ? `${y}-${String(month(m)).padStart(2, "0")}-${d}`
            : null;
        if (!id || !range) {
          rejected++;
          return;
        }
        const venueLink = c.find(".fa-map-marker").parent().find("a").first(),
          path = new URL(href, url).pathname.split("/").filter(Boolean);
        // Venue pages have four path segments (country/state/city/venue) and
        // state the venue address in their header; city pages have three.
        const locality =
          place.length === 4 && venueHeader.length >= 4
            ? venueHeader.at(-3)
            : place.length === 3 && cityHeading.length >= 2
              ? cityHeading[0]
              : undefined;
        const r = eventRecord(
          config,
          {
            id: `conventioncalendar:${id}|${iso(range[1], range[2], range[3])}`,
            title: link.find("h5").text(),
            url: href,
            startDate: iso(range[1], range[2], range[3]),
            endDate: iso(range[4], range[5], range[6]),
            dateTimeBasis: {
              start: "visible listing date",
              end: "visible listing date",
            },
            location: {
              venue: text(venueLink.text()),
              locality,
              region: path[1]?.toUpperCase(),
              country: path[0]?.toUpperCase(),
              basis:
                "upstream card venue; country and state from the event URL path",
            },
            categoryTags: c
              .find(".badge")
              .first()
              .map((_, b) => text($(b).text()))
              .get()
              .filter((label) => label && !/ days? event$/i.test(label))
              .map((label) => ({ label, basis: "upstream event type badge" })),
            raw: {
              eventId: id,
              date: text(c.find(".fa-calendar-check").parent().text()),
              duration: text(c.find(".fa-clock").parent().text()),
            },
          },
          { url, selector: ".entity-list-card" },
        );
        if (r) records.push(r);
        else rejected++;
      });
      // Months with events are listed in the menu. Every month, including the
      // one the undated page shows, is requested explicitly; a repeated month
      // observes the same event identities and is not counted twice.
      const seenMonths = new Set();
      $('a.dropdown-item[href*="date="]').each((_, e) => {
        const target = new URL($(e).attr("href"), url);
        const date = target.searchParams.get("date");
        if (
          target.pathname !== here.pathname ||
          !/^\d{4}-\d\d-01$/.test(date ?? "") ||
          date === requestedMonth ||
          seenMonths.has(date)
        )
          return;
        seenMonths.add(date);
        nextRequests.push({
          url: target.origin + target.pathname + `?date=${date}`,
          kind: "listing",
          depth: 0,
          meta: { month: date },
        });
      });
      if (!cards.length && !monthButton && !requestedMonth) {
        if (!$(".cc-tabs").length)
          throw Object.assign(
            new Error("Venue/city listing contract missing"),
            {
              code: "contract_changed",
            },
          );
      }
      // Within-month paging is followed through rel=next links by the shared
      // navigation; an unrecognised page control must not look exhausted.
      if (
        $('a[href*="page="]').length &&
        !$('a[rel="next"],.pagination .next a').length
      )
        issues.push({ code: "listing_pagination_unverified" });
      coverage = "verified-list";
      terminal = true;
    }
  } else if (config.adapter === "discover-la") {
    $(".view-events-day article.node--type-event").each((_, el) => {
      const a = $(el)
        .find('a[data-description="Title link"][data-start-date][data-nid]')
        .first();
      if (!a.length) {
        count++;
        rejected++;
        return;
      }
      const pathDate = a
        .attr("href")
        ?.match(/\/event\/(\d{4})\/(\d{2})\/(\d{2})\//)
        ?.slice(1)
        .join("-");
      add(
        {
          title: a.attr("data-content-title"),
          url: a.attr("href"),
          id: `${a.attr("data-nid")}|${a.attr("data-start-date")}`,
          startDate: a.attr("data-start-date"),
          location: {
            venue: a.attr("data-venue"),
            basis: "publisher event card data-venue",
          },
          categoryTags: [
            {
              label: a.attr("data-category"),
              basis: "publisher event card data-category",
            },
          ],
          warnings:
            pathDate && pathDate !== a.attr("data-start-date")
              ? ["source_tracking_date_conflict"]
              : [],
          raw: {
            nodeId: a.attr("data-nid"),
            startDate: a.attr("data-start-date"),
            cardTitle: a.attr("data-content-title"),
          },
        },
        '.view-events-day article a[data-description="Title link"]',
      );
    });
  } else if (config.adapter === "nyc-tourism") {
    $('[class*="Card_card__"]').each((_, el) => {
      const c = $(el),
        a = c.find('a[class*="ContentCard_headerLink"]').first();
      if (!a.length) return;
      const rawDate = text(
        c.find('[class*="ContentCard_tagContainer"]').text(),
      );
      if (!dates(rawDate).startDate) {
        count++;
        nextRequests.push({
          url: new URL(a.attr("href"), url).href,
          kind: "detail",
          depth: 1,
          meta: { undatedListing: true, listingTitle: text(a.text()) },
        });
        return;
      }
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          rawDate,
          categoryTags: c
            .find(
              '[class*="ContentCard_taglines"] [class*="ContentCard_tag--default"] span',
            )
            .map((_, e) => ({
              label: text($(e).text()),
              basis: "upstream card category",
            }))
            .get(),
          raw: { date: rawDate },
        },
        "[class*=Card_card__] with ContentCard_headerLink",
      );
    });
  } else if (config.adapter === "opencities") {
    $(".list-item-container").each((_, el) => {
      const c = $(el),
        date = c.find(".list-item-block-date").first();
      if (!date.length) return;
      const a = c.find("a[href]").first(),
        rawDate = `${text(date.find(".part-month").text())} ${text(date.find(".part-date").text())}, ${text(date.find(".part-year").text())}`;
      add(
        {
          title: c.find(".list-item-title").text(),
          url: a.attr("href"),
          rawDate,
          categoryTags: c
            .find(".tagged-as-list .text")
            .map((_, e) => ({
              label: text($(e).text()).replace(/^,\s*/, ""),
              basis: "upstream category",
            }))
            .get(),
          warnings: ["listing_date_only_detail_duration_unverified"],
          raw: { date: text(date.text()) },
        },
        ".list-item-container .list-item-block-date",
      );
    });
  } else if (config.adapter === "san-diego") {
    let rows = 0,
      privateRows = 0,
      unclassified = 0;
    $(".event-row").each((_, el) => {
      rows++;
      const c = $(el),
        a = c.find("h2 a").first(),
        values = c
          .find(".row.data span")
          .map((_, e) => text($(e).text()))
          .get();
      // Unnamed "Private" bookings have no public identity or page; they are
      // counted, not invented as events.
      if (!a.length) {
        // A placeholder carries no event identity; a linked "Private" row
        // would be a public event that must not be excluded.
        const linked = c.find("a[href]").length > 0;
        if (values[0] === "Private" && !linked) privateRows++;
        else unclassified++;
        return;
      }
      // One row is one event: a second distinct event link would be dropped.
      const links = new Set(
        c
          .find("a[href]")
          .map((_, e) => $(e).attr("href"))
          .get()
          .filter((h) => /\/calendar\/[^/?#]+/.test(h)),
      );
      if (c.find("h2 a").length !== 1 || links.size !== 1) unclassified++;
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          startDate: dates(values[2]).startDate,
          endDate: dates(values[3]).startDate,
          location: {
            venue: "San Diego Convention Center",
            locality: "San Diego",
            region: "CA",
            country: "US",
            basis: "single-venue calendar",
          },
          categoryTags: [{ label: values[1], basis: "upstream event type" }],
          raw: { tableValues: values },
        },
        ".event-row .row.data span",
      );
    });
    // Inspected November 4, 2026: "Load more" only unhides `.calendar .item`
    // rows already in the server HTML. Completeness rests on behaviour the
    // browser observed (transport revealProbe), not on reading scripts: the
    // control was clicked until gone, every item became visible, the item
    // count did not change and no publisher request was made. Every item is
    // exactly one public parsed row or a private placeholder.
    if (config.listCompleteness === "client-reveal") {
      const items = $(".calendar .item").length;
      const reveal =
        interaction?.probe === "reveal" &&
        !interaction.error &&
        // Exactly one control, so the exercised element is the exempted one.
        interaction.controls === 1 &&
        $(".calendar .loadMore").length === 1 &&
        // The control existed, started hidden rows, and was actually used.
        interaction.controlVisibleBefore === true &&
        interaction.clicks > 0 &&
        interaction.visibleBefore < items &&
        interaction.requests?.length === 0 &&
        interaction.controlVisibleAfter === false &&
        interaction.itemsBefore === items &&
        interaction.itemsAfter === items &&
        interaction.itemsUnchanged === true &&
        interaction.visibleAfter === items;
      const paged = otherPagingControls($, url).length;
      if (
        reveal &&
        !paged &&
        !unclassified &&
        !rejected &&
        rows === count + privateRows &&
        // Every public row is a distinct emitted identity (none merged).
        new Set(records.map((r) => r.sourceRecordId)).size === count &&
        // Every revealable item must be exactly one accounted row.
        rows === $(".calendar .item").length &&
        $(".calendar .item")
          .toArray()
          .every((item) => $(item).find(".event-row").length === 1) &&
        rows === $(".calendar .item .event-row").length
      ) {
        coverage = "verified-list";
        terminal = true;
      } else issues.push({ code: "single_page_contract_unverified" });
    }
    if (privateRows) excluded.privatePlaceholders = privateRows;
  } else if (config.adapter === "sf-portal") {
    $("tr.resultlist").each((_, el) => {
      const c = $(el),
        title = text(c.find("strong").first().text()),
        rawDate = dates(c.text());
      const venue = text(c.find("span").first().text());
      add(
        {
          title,
          url: `${url}#event=${encodeURIComponent(title)}&date=${rawDate.startDate}`,
          startDate: rawDate.startDate,
          endDate: rawDate.endDate,
          location: {
            venue,
            basis: "upstream venue row; city market is separate provenance",
          },
          raw: { rowText: text(c.text()) },
        },
        "tr.resultlist",
      );
    });
  } else if (config.adapter === "trade-table") {
    $("tr.row").each((_, el) => {
      const c = $(el),
        a = c.find(".r-Name a").first();
      if (!a.length) {
        count++;
        rejected++;
        return;
      }
      if (c.find(".r-VenLoc").length) {
        // TSNN's embedded table (thetradeshowcalendar.com/tsnn/): the date cell
        // holds "MON/DD/YYYY" start and end separated by a line break, and one
        // "Venue City, ST, Country" cell whose venue/city boundary is not marked,
        // so it is kept whole instead of being split by guesswork.
        const stamps = [
          ...(c.find(".r-Dates").html() ?? "").matchAll(
            /\b([A-Za-z]{3})\/(\d{1,2})\/(\d{4})\b/g,
          ),
        ].map((m) => dates(`${m[1]} ${m[2]}, ${m[3]}`).startDate);
        const place = text(c.find(".r-VenLoc").text());
        const parts = place.split(/,\s*/);
        const country = parts.length > 1 ? parts.at(-1) : null;
        const state =
          country === "United States" && /^[A-Z]{2}$/.test(parts.at(-2) ?? "")
            ? parts.at(-2)
            : null;
        const title = text(a.text());
        add(
          {
            title,
            url: a.attr("href"),
            id: `${safeUrl(a.attr("href"), url) ?? a.attr("href")}|${stamps[0]}||${title}`,
            startDate: stamps[0],
            endDate: stamps.length > 1 ? stamps.at(-1) : undefined,
            dateTimeBasis: {
              start: "visible listing date",
              end: stamps.length > 1 ? "visible listing date" : null,
            },
            location: {
              formattedAddress: place,
              region: state,
              country: country === "United States" ? "US" : country,
              basis:
                "upstream venue/location cell; venue and city not separated",
            },
            raw: {
              dates: text(
                (c.find(".r-Dates").html() ?? "").replace(/<br\s*\/?>/gi, " "),
              ),
              venueLocation: place,
              attendance: text(c.find(".r-AttExhNSF").text()),
            },
          },
          "tr.row .r-Name/.r-Dates/.r-VenLoc",
        );
        return;
      }
      const original = text(c.find(".r-Dates").text());
      const rawDate = original
        .replace(/([A-Za-z]+)\//g, "$1 ")
        .replace(/\/(\d{4})$/, ", $1");
      const country = text(c.find(".r-Ctry").text());
      const city = text(c.find(".r-City").text());
      // US rows read "City, ST"; the state is an upstream component of the cell.
      const us =
        country === "United States"
          ? city.match(/^(.*?),\s*([A-Z]{2})$/)
          : null;
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          // Distinct rows can share one organizer website and start date
          // (e.g. an event listed under two names); the row title separates them.
          id: `${safeUrl(a.attr("href"), url) ?? a.attr("href")}|${dates(rawDate).startDate}||${text(a.text())}`,
          rawDate,
          location: {
            locality: us ? us[1] : city,
            region: us?.[2],
            country: country === "United States" ? "US" : country,
            basis: "upstream table cells",
          },
          raw: { date: original },
        },
        "tr.row .r-Name/.r-Dates/.r-City/.r-Ctry",
      );
    });
  } else if (config.adapter === "chicago-parks") {
    $(".node--type-event.node--view-mode-card").each((_, el) => {
      const c = $(el),
        a = c.find(".event--title a").first(),
        times = c.find("time[datetime]");
      if (!a.length) return;
      const locationText = text(c.find(".event--location").text());
      const address = locationText.match(
        /^(.*?)\s+(Chicago),\s*(IL)\s+(\d{5}(?:-\d{4})?)$/,
      );
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          startDate: times.first().attr("datetime"),
          endDate: times.last().attr("datetime"),
          location: {
            formattedAddress: locationText,
            streetAddress: address?.[1],
            locality: address?.[2],
            region: address?.[3],
            postalCode: address?.[4],
            basis: "upstream card location",
          },
          raw: { date: text(c.find(".event--duration").text()) },
        },
        ".node--type-event.node--view-mode-card time",
      );
    });
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  if (!count) issues.push({ code: "expected_source_cards_missing" });
  return {
    records,
    method: config.adapter,
    observedCount: count,
    rejected,
    issues,
    coverage,
    terminal,
    nextRequests,
    ...(expectedTotal != null ? { expectedTotal } : {}),
    ...(Object.keys(excluded).length ? { excluded } : {}),
  };
}
