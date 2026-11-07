// Additional contracts derived from captured publisher HTML, not guessed from platform names.
import { load } from "cheerio";
import { dates, eventRecord, text } from "../records.mjs";
import { parseVisitSeattle } from "./regional.mjs";
export const inspectedAdapters = new Set([
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
    terminal = false;
  const excluded = {};
  const add = (input, selector) => {
    count++;
    const r = eventRecord(config, input, { url, selector });
    if (r) records.push(r);
    else rejected++;
  };
  if (config.adapter === "discover-la") {
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
      if (!a.length) return;
      const original = text(c.find(".r-Dates").text());
      const rawDate = original
        .replace(/([A-Za-z]+)\//g, "$1 ")
        .replace(/\/(\d{4})$/, ", $1");
      const country = text(c.find(".r-Ctry").text());
      add(
        {
          title: a.text(),
          url: a.attr("href"),
          rawDate,
          location: {
            locality: text(c.find(".r-City").text()),
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
    ...(Object.keys(excluded).length ? { excluded } : {}),
  };
}
