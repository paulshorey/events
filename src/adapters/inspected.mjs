// Additional contracts derived from captured publisher HTML, not guessed from platform names.
import { load } from "cheerio";
import { dates, eventRecord, safeUrl, text } from "../records.mjs";
import { parseVisitSeattle } from "./regional.mjs";
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
  "expofp-venue",
  "hotel-event-list",
  "visitseattle",
]);
const slug = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
// Convention-centre location stated by the single-venue guide pages.
const occcLocation = (basis) => ({
  venue: "Orange County Convention Center",
  locality: "Orlando",
  region: "FL",
  country: "US",
  basis,
});
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

export function parseInspected({ html, url, config, interaction, task }) {
  if (config.adapter === "visitseattle")
    return parseVisitSeattle({ html, url, config, task });
  const $ = load(html),
    records = [],
    issues = [],
    nextRequests = [];
  let count = 0,
    rejected = 0,
    coverage = "unverified",
    expectedTotal,
    verifiedEmpty = false,
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
    coverage = "verified-list";
    const next = (params) => {
      const u = new URL(url);
      u.hash = "";
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u;
    };
    if (!config.windowedSearch) {
      terminal = shown >= total;
      if (!terminal)
        nextRequests.push({
          url: next({ page: String(page + 1) }).href,
          kind: "listing",
          depth: 0,
          meta: { pagination: true },
        });
      expectedTotal = total;
    } else {
      // Rating order has ties and is not stable between requests, so paging
      // the whole directory repeats some events and misses others. Start-date
      // windows (`minDate`/`maxDate`, inspected as inclusive filters on the
      // start day) are split until each holds at most one page; only a single
      // day with more than a page is paged. The root request states the
      // directory total; every window is verified against its own bounds.
      terminal = true;
      const query = new URL(url).searchParams;
      const day = (value) => new Date(`${value}T00:00:00Z`);
      const iso = (date) => date.toISOString().slice(0, 10);
      const plus = (date, n) => new Date(date.getTime() + n * 86400000);
      const min = query.get("minDate"),
        max = query.get("maxDate");
      if (min == null && max == null) {
        // Root: months from the server's default start to the horizon.
        expectedTotal = total;
        const from = day(args.filters?.minDate ?? "");
        const horizon = day(config.windowHorizon ?? "");
        if (Number.isNaN(from.getTime()) || Number.isNaN(horizon.getTime()))
          throw Object.assign(new Error("Tradefest window bounds missing"), {
            code: "contract_changed",
          });
        for (
          let start = from;
          start <= horizon;
          start = new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
          )
        ) {
          const end = plus(
            new Date(
              Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
            ),
            -1,
          );
          nextRequests.push({
            url: next({ minDate: iso(start), maxDate: iso(end) }).href,
            kind: "listing",
            depth: 0,
            meta: { window: [iso(start), iso(end)] },
          });
        }
      } else {
        if (
          !/^\d{4}-\d\d-\d\d$/.test(min ?? "") ||
          !/^\d{4}-\d\d-\d\d$/.test(max ?? "") ||
          args.filters?.minDate !== min ||
          args.filters?.maxDate !== max ||
          nodes.some((n) => n.startDate < min || n.startDate > max)
        )
          throw Object.assign(
            new Error(`Tradefest window ${min}..${max} not honoured`),
            { code: "pagination_changed" },
          );
        if (total === 0 && !nodes.length) verifiedEmpty = true;
        if (total > limit && min < max) {
          const mid = iso(
            plus(day(min), Math.floor((day(max) - day(min)) / 86400000 / 2)),
          );
          for (const [a, b] of [
            [min, mid],
            [iso(plus(day(mid), 1)), max],
          ])
            nextRequests.push({
              url: next({ minDate: a, maxDate: b, page: "1" }).href,
              kind: "listing",
              depth: 0,
              meta: { window: [a, b] },
            });
        } else if (shown < total)
          // One day larger than a page: page it. Ties may reorder rows
          // between requests, so the run's count check decides completeness.
          nextRequests.push({
            url: next({ page: String(page + 1) }).href,
            kind: "listing",
            depth: 0,
            meta: { window: [min, max], page: page + 1 },
          });
      }
    }
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
      // Every destination card must resolve to exactly one same-host city
      // page; a card that does not would silently drop that city.
      const cities = new Set();
      let unaccounted = 0;
      $(".entity-grid-card").each((_, card) => {
        const own = new Set();
        $(card)
          .find("a[href]")
          .each((_, e) => {
            const target = safeUrl($(e).attr("href"), url);
            if (!target) return;
            const t = new URL(target);
            if (t.hostname === here.hostname && cityPath.test(t.pathname))
              own.add(t.origin + t.pathname);
          });
        if (own.size !== 1) unaccounted++;
        for (const city of own) cities.add(city);
      });
      if (unaccounted)
        throw Object.assign(
          new Error(`${unaccounted} destination card(s) without one city page`),
          { code: "contract_changed" },
        );
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
      // Destinations with nothing scheduled say so explicitly ("Events 0",
      // "No events available to display"); that is an empty listing, not a
      // missing contract.
      if (
        !cards.length &&
        !monthButton &&
        /No events available to display/i.test($("body").text())
      )
        verifiedEmpty = true;
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
        !verifiedEmpty &&
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
    // Convention calendar form (GET startdate/enddate). The page states how
    // many meetings matched ("N found") and renders them all in one document;
    // the server clamps the window to one year from today, so a wider enddate
    // cannot be requested. Observed 2026-11-05.
    $("tr.resultlist").each((_, el) => {
      const c = $(el),
        title = text(c.find("strong").first().text()),
        rawDate = dates(c.text());
      const venue = text(c.find("span").first().text());
      // "Venue Type" is sometimes a category (Hotel) rather than a venue name.
      const genericVenue = /^(?:hotel|other|various|tbd|tba)$/i.test(venue);
      const organizer = text(
        c.find("strong").first().nextAll("br").first()[0]?.nextSibling?.data ??
          "",
      );
      add(
        {
          title,
          url: `${url}#event=${encodeURIComponent(title)}&date=${rawDate.startDate}`,
          startDate: rawDate.startDate,
          endDate: rawDate.endDate,
          location:
            venue && !genericVenue
              ? {
                  venue,
                  basis:
                    "upstream venue row; city market is separate provenance",
                }
              : null,
          raw: {
            rowText: text(c.text()),
            organizer: organizer || undefined,
            venueType: genericVenue ? venue : undefined,
          },
        },
        "tr.resultlist",
      );
    });
    const found = text($("form[name=searchform]").text()).match(
        /\b(\d+) found\b/,
      ),
      rows = $("tr.resultlist").length;
    if (
      found &&
      Number(found[1]) === rows &&
      rows === records.length &&
      !rejected &&
      $("form[name=searchform] input[name=startdate]").length === 1 &&
      $("form[name=searchform] input[name=enddate]").length === 1 &&
      !$("a[rel=next], [class*=pager], [class*=pagination]").length
    ) {
      coverage = "verified-list";
      terminal = true;
    } else issues.push({ code: "single_page_contract_unverified" });
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
    let cards = 0;
    $(".node--type-event.node--view-mode-card").each((_, el) => {
      cards++;
      const c = $(el),
        a = c.find(".event--title a").first(),
        times = c.find("time[datetime]");
      if (!a.length) {
        count++;
        rejected++;
        return;
      }
      const locationText = text(c.find(".event--location").text());
      const address = locationText.match(
        /^(.*?)\s+(Chicago),\s*(IL)\s+(\d{5}(?:-\d{4})?)$/,
      );
      // Multi-day cards print full dates. The datetime attribute is a UTC
      // instant whose date can differ from the printed day, so the printed
      // text is the evidence. Single-day cards print only month and day:
      // their detail page states the year, and the year is never guessed.
      const printed = times.map((_, e) => dates($(e).text()).startDate).get();
      if (!printed.length || printed.some((d) => !d)) {
        count++;
        nextRequests.push({
          url: new URL(a.attr("href"), url).href,
          kind: "detail",
          depth: 1,
          meta: {
            undatedListing: true,
            listingTitle: text(a.text()),
            listingDate: text(c.find(".event--date").text()),
          },
        });
        return;
      }
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          startDate: printed[0],
          endDate: printed.at(-1),
          dateTimeBasis: {
            start: "printed listing date",
            end: "printed listing date",
          },
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
    // Drupal pager: the requested page must be the active one, every card must
    // be accounted for, and the last page is the one without a next link.
    const pager = $("nav.pager .pagination"),
      active = pager.find("li.is-active a").first().attr("href"),
      requested = new URL(url).searchParams.get("page") ?? "0";
    if (
      cards &&
      !rejected &&
      pager.length === 1 &&
      pager.find("li.is-active").length === 1 &&
      active?.match(/[?&]page=(\d+)/)?.[1] === requested
    ) {
      coverage = "verified-list";
      terminal = pager.find("li.pager__item--next a[rel=next]").length === 0;
    } else if (cards) issues.push({ code: "pager_contract_unverified" });
  } else if (config.adapter === "expofp-venue") {
    // Inspected November 5, 2026: server-rendered venue page with two lists.
    // `tr.event-row` rows carry a visible date range (with year), a title and
    // an ExpoFP detail link; `tr.venue-expo-item` cards carry a title, the
    // organiser's website, a date range and the ExpoFP floor-plan link. The
    // Hall column was empty for every row, so no hall is claimed.
    $("tr.event-row").each((_, el) => {
      const c = $(el),
        a = c.find("a.event-link").first(),
        rawDate = text(c.find("td").first().text());
      if (!a.length) return;
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          rawDate,
          location: occcLocation("single-venue page"),
          raw: {
            date: rawDate,
            hall: text(c.find("td").last().text()) || null,
          },
        },
        "tr.event-row td date; a.event-link",
      );
    });
    $("tr.venue-expo-item").each((_, el) => {
      const c = $(el),
        title = text(c.find(".venue-expo-item__text-name span").first().text()),
        site = c.find("a.venue-expo-item__text-link-title").first(),
        plan = c.find("a.venue-expo-item__text-link-floor-plan").first(),
        rawDate = text(
          c.find(".venue-expo-item__text-date span").last().text(),
        );
      const planUrl = plan.attr("href");
      add(
        {
          title,
          url: planUrl ?? site.attr("href"),
          rawDate,
          location: occcLocation("single-venue page"),
          raw: {
            date: rawDate,
            website: text(site.text()) || null,
            floorPlan: planUrl ?? null,
          },
        },
        "tr.venue-expo-item name/date/floor-plan link",
      );
    });
  } else if (config.adapter === "hotel-event-list") {
    // Hotel guides listing the convention centre's dates. Neither page has a
    // per-event URL, so identity is the guide URL plus a title fragment and the
    // listed dates. Both were inspected November 5, 2026: Ramada uses
    // `table.events-table` rows (title, "Mon D-D, YYYY"); Wyndham uses a bold
    // title paragraph followed by "Start Date: ... | End Date: ...". A multi-month
    // event repeated under several month headings is one listed occurrence.
    const seen = new Set();
    let duplicates = 0;
    const addRow = (title, rawDate, selector) => {
      const range = dates(rawDate),
        key = `${slug(title)}|${range.startDate}|${range.endDate}`;
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      add(
        {
          title,
          url: `${url.split("#")[0]}#${slug(title)}`,
          rawDate,
          location: occcLocation("hotel guide for the convention centre"),
          raw: { date: rawDate },
        },
        selector,
      );
    };
    $("table.events-table tr").each((_, el) => {
      const cells = $(el).find("td");
      if (cells.length === 2)
        addRow(
          text(cells.first().text()),
          text(cells.last().text()),
          "table.events-table tr td title/date",
        );
    });
    $(".panel-body p").each((_, el) => {
      const p = $(el),
        title = text(p.find("strong").first().text());
      if (!title) return;
      // 2026 panels use a title paragraph followed by a date paragraph; 2027
      // panels hold both in one paragraph.
      const own = text(p.text()),
        marker = own.search(/Start Date:/i),
        next = text(p.next("p").text());
      if (marker >= 0)
        addRow(title, own.slice(marker), ".panel-body p strong 'Start Date:'");
      else if (/^Start Date:/i.test(next))
        addRow(title, next, ".panel-body p strong + p 'Start Date:'");
    });
    if (duplicates) excluded.repeatedMonthRows = duplicates;
  }
  if (rejected)
    issues.push({ code: "records_require_parse_review", count: rejected });
  if (!count && !verifiedEmpty)
    issues.push({ code: "expected_source_cards_missing" });
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
    ...(verifiedEmpty ? { verifiedEmpty } : {}),
    ...(Object.keys(excluded).length ? { excluded } : {}),
  };
}
