// Additional contracts derived from captured publisher HTML, not guessed from platform names.
import { load } from "cheerio";
import { dates, eventRecord, text } from "../records.mjs";
export const inspectedAdapters = new Set([
  "nyc-tourism",
  "opencities",
  "san-diego",
  "sf-portal",
  "trade-table",
  "chicago-parks",
  "discover-la",
]);
export function parseInspected({ html, url, config, interaction }) {
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
        if (values[0] === "Private") privateRows++;
        else unclassified++;
        return;
      }
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
        // The control existed, started hidden rows, and was actually used.
        interaction.controlVisibleBefore === true &&
        interaction.clicks > 0 &&
        interaction.visibleBefore < items &&
        interaction.requests?.length === 0 &&
        interaction.controlVisibleAfter === false &&
        interaction.itemsBefore === items &&
        interaction.itemsAfter === items &&
        interaction.visibleAfter === items;
      const paged = $('a[rel="next"], .pagination a, a[href*="page="]').length;
      if (
        reveal &&
        !paged &&
        !unclassified &&
        !rejected &&
        rows === count + privateRows &&
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
    ...(Object.keys(excluded).length ? { excluded } : {}),
  };
}
