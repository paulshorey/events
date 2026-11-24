import { load } from "cheerio";
import { parseDateRange } from "../../examples/parsers.mjs";
import { eventRecord } from "../records.mjs";

// This calendar entry recurs at the same URL. Its visible date supplies the edition.
export function parsePlazaExpo(html, url, config) {
  const $ = load(html);
  const fail = () => {
    throw Object.assign(new Error("Plaza Expo event page contract changed"), {
      code: "contract_changed",
    });
  };
  const title = $("h1.singular-title");
  const bars = $(".event-details-bar");
  if (
    url !== config.url ||
    $('link[rel="canonical"]').attr("href") !== url ||
    title.length !== 1 ||
    title.text().trim() !== "Downtown Christmas Expo" ||
    bars.length !== 1
  )
    fail();
  const field = (name) => {
    const label = bars
      .find("p > strong")
      .filter((_, e) => $(e).text().trim().toLowerCase() === name);
    if (label.length !== 1) fail();
    const p = label.parent().clone();
    p.find("strong").remove();
    return p.text().trim().replace(/\s+/g, " ");
  };
  const venue = field("location"),
    hours = field("time"),
    rawDate = field("date");
  const { startDate, endDate } = parseDateRange(rawDate);
  const footer = $(".footer-white").clone();
  footer.children().remove();
  const address = footer
    .text()
    .trim()
    .match(/^(1 Main Street), (Las Vegas), (Nevada) (89101)$/i);
  if (
    !startDate ||
    !endDate ||
    !/^(?:3rd Floor\s*\|\s*)?Plaza Convention Center$/i.test(venue) ||
    !address ||
    !hours
  )
    fail();
  // Printed opening hours on a multiday expo are not dated occurrence boundaries.
  const record = eventRecord(
    config,
    {
      id: url + "#" + startDate.slice(0, 4),
      title: title.text().trim(),
      url,
      startDate,
      endDate,
      location: {
        venue,
        streetAddress: address[1],
        locality: address[2],
        region: address[3],
        postalCode: address[4],
        basis: "event venue and hotel's published address",
      },
      raw: { rawDate, venue, hours },
    },
    { url, selector: ".event-details-bar, h1.singular-title, .footer-white" },
  );
  if (!record) fail();
  return {
    records: [{ ...record, validationStatus: "parser-validated" }],
    issues: [],
    nextRequests: [],
    observedCount: 1,
    rejected: 0,
    terminal: true,
    coverage: "verified-list",
    method: "plaza-expo-event-page",
  };
}
