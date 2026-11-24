# New York Boat Show and TravMedia at the Javits Center

On November 24, 2026, the [Javits discovery query](../db/queries/new_york_javits_publisher_claims.sql) returned **25 rows from 26 source claims** in the 90-day New York reporting window. The Boat Show was the one edition reviewed for cross-publisher grouping. Other possible matches remain separate pending review. The two selected complete dev runs were collected November 5 with the recorded experimental robots opt-out. The query exposes that setting on each claim.

| January 20 listing | Javits venue calendar | ConventionCalendar | Discovery result |
| --- | --- | --- | --- |
| Discover Boating New York Boat Show | `event-59155`, January 20–24, 2027 | Listing `420414`, January 20–24, 2027 | One edition, two publishers |
| TravMedia International Media Marketplace USA | `event-60965`, January 20–21, 2027 | No matching claim in the selected run | Separate venue listing |

The two Boat Show observations have distinct publisher IDs and event URLs. Each explicitly identifies the Javits venue and a city in New York State. The venue adapter derives location from the single-venue calendar’s published footer address. The directory uses the venue heading, linked card and geographic URL path. Javits also links the Boat Show organizer's website. The organizer confirms January 20–24 at Javits. Its hours are separate from the date-only listing observations. The direct TravMedia organizer lookup returned HTTP 403, so the TravMedia dates here rely on the Javits capture. [Boat Show organizer](https://www.nyboatshow.com/about) · [Javits Boat Show listing](https://www.javitscenter.com/calendar#event-59155) · [Directory listing](https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center/discover-boating-new-york-boat-show-1-420414) · [Javits TravMedia listing](https://www.javitscenter.com/calendar#event-60965)

The query reads the latest complete run per collection, then requires the expected publisher and an explicit Javits venue, city, state and country on each included claim. Only the reviewed 2027 publisher occurrence IDs and exact URLs share a group. A publisher change to either identity requires fresh review. Conflicting or missing end dates leave the summary end date open. The individual claims retain their dates, source locations, URLs, run IDs, record keys and capture hashes.

## Evidence and checks

| Delivered run | Page | Replayed evidence | SHA-256 |
| --- | --- | --- | --- |
| Javits `05903d9f-7a21-4d81-9de4-28cbac16183d` | 63 | January API response, 7,003 bytes, contains both distinct venue events | `3937b3b5bc14cb64cbb6a3b00719cc35ddcaf242352beddfd2ef06b3d2dadcbd` |
| ConventionCalendar `18b2a71c-f077-464f-9f63-8f8bfada575c` | 1410 | January venue calendar HTML, 105,259 bytes, contains the directory Boat Show claim | `6a6daf4d57d28bd9597f90997a37de2619bfef51db0ea9f853ec9403e5e497d9` |

Offline replay with the frozen run configurations reproduced all three occurrence IDs and date ranges. The dev read-only role retrieved both compressed evidence objects. After decompression their byte lengths and SHA-256 hashes matched the replayed captures. The Javits claim exposes the actual monthly API URL as well as the journal's calendar task URL.

The [SQL regression](../tests/new-york-javits-publisher-claims.test.mjs) runs the report against disposable PostgreSQL. It covers two real same-venue, same-start-date events, an additional identical-title/date case, a newer partial run, unknown or conflicting end dates, a changed publisher link and missing city evidence.

A November 24 default-policy preflight stopped at HTTP 429 on Javits robots.txt. The directory’s venue and January paths passed the robots check. Neither publisher was recrawled for this report. Verification outputs are under `.artifacts/collection/javits-edition-2026-11-24/`.

The next saved-data comparison is ICSC New York and AI Summit New York. Both publishers list both events at Javits on December 9–10, 2026. Review the two intended pairs and reject the two crossed pairs before expanding the match set.
