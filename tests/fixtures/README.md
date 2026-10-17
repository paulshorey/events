# Captured regression examples

These small fixtures were selected from public pages/API responses inspected on October 16, 2026 (America/Chicago). They support offline parser regression checks; they do not establish current source compatibility.

- `la-calendar.html`: the first two event cards from https://www.laconventioncenter.com/events/all. The first event is AAO-HNSF, October 17–20, 2026. Missing times must remain unknown.
- `boston-calendar.html`: selected cards from https://www.boston.gov/events. Includes an internal node link, an external event link, and a repeated Digital Literacy Workshop node on different dates. Irrelevant descriptions, contact fields, and images were removed. The visible grouped dates and times are the occurrence evidence.
- `tribe-page.json`: one event from https://network.vegas/wp-json/tribe/events/v1/events with `start_date=2026-10-16`, `per_page=5`, `page=1`. Its all-day flag conflicts with a timed description. Image metadata was removed. The conflict must remain visible rather than being silently corrected.

Original run captures and the initially failed Boston attempt remain in ignored `.artifacts/`. The Boston link-format tests failed before the adapter fix and passed afterward.

`jsonld-null-fields.json` is a synthetic contract fixture for optional null identifiers/countries and missing event URLs. It is not a captured publisher event. Redirect tests use two loopback hostnames and a controlled local server; they never contact external websites.

The additional `nyc-tourism`, `orlando`, `downtown-orlando`, `san-diego`, `sf-portal`, `trade-table`, `chicago-parks`, `festivalindex`, and `dc-tourism` HTML files are bounded excerpts from the October 16/17, 2026 reconnaissance captures. Table excerpts retain a table wrapper because HTML parsing otherwise discards standalone rows. These fixtures preserve source dates and structure; they are historical parser contracts, not current event recommendations. Chicago's second card deliberately lacks a year-bearing timestamp and must be rejected rather than guessing the year. Full local captures remain in ignored artifacts.
