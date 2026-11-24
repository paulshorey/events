import { text, dates, eventRecord, safeUrl } from "../records.mjs";

// washington.org /find-dc-listings/events: a Drupal view of .dcevent-wrapper
// cards, eight per page, ordered by start date, with a ?page=N pager.
export function parseDcListing($, url, config) {
  const cards = $(".dcevent-wrapper"),
    records = [],
    issues = [];
  let rejected = 0;
  cards.each((_, e) => {
    const c = $(e),
      a = c
        .find("a[href]")
        .filter((_, a) => /\/event\//.test($(a).attr("href")))
        .first(),
      href = a.attr("href"),
      heading = text(c.find("h6.label").first().text()),
      cardText = text(c.find(".card-text").first().text()),
      area = text(c.find(".dcevent__label").first().text()),
      venue = text(c.find(".client_reference").first().text()),
      label =
        text(c.find("p.date").first().text()) ||
        `${text(c.find(".date__input--month").text())} ${text(c.find(".date__input--day").text())}, ${text(c.find(".date__input--year").text())}`;
    // h6.label is cut near 40 characters with an ellipsis. .card-text repeats
    // the full title only when the event has no separate teaser; otherwise it
    // is a description and the listing cannot supply the full title.
    const ellipsis = /(?:\.{3}|…)$/,
      truncated = ellipsis.test(heading),
      stem = heading.replace(ellipsis, "").trim();
    const title = truncated && cardText.startsWith(stem) ? cardText : heading;
    const warnings = [];
    if (truncated && title === heading)
      warnings.push("title_truncated_in_listing");
    // "Now - Nov 15, 2026" marks an event already under way. Its real start is
    // only on the detail page, so the collection date is recorded as a lower
    // bound with an explicit basis and warning, never as the event's start.
    const ongoing = label.match(/^Now\s*[-–]\s*(.+)$/i);
    let input = { rawDate: label };
    if (ongoing) {
      const end = dates(ongoing[1]).endDate;
      warnings.push("start_date_is_collection_date_listing_says_now");
      input =
        config.asOf && end
          ? {
              sourceRecordId: safeUrl(href, url),
              startDate: config.asOf,
              endDate: end,
              dateTimeBasis: {
                start:
                  "collection date; listing label 'Now' (already under way)",
                end: "visible listing date",
              },
            }
          : null;
    }
    const record = input
      ? eventRecord(
          config,
          {
            title,
            url: href,
            ...input,
            location: venue
              ? { venue, basis: "source event card venue reference" }
              : null,
            warnings,
            raw: {
              area,
              venue,
              date: label,
              headingText: heading,
              cardText: cardText === title ? undefined : cardText,
              featured: c.find(".featured-flag").length > 0,
            },
          },
          { url, selector: ".dcevent-wrapper" },
        )
      : null;
    record ? records.push(record) : rejected++;
  });
  return { records, observedCount: cards.length, rejected, issues };
}
