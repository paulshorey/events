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
        // A confirmed event link is not paging, whatever its title says.
        if (el.is("a") && path && EVENT_PATH.test(path)) return false;
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
