# Las Vegas discovery and evidence recovery

November 24, 2026. Development database only.

## Publisher comparison

The Plaza Hotel & Casino publishes a named Downtown Christmas Expo calendar entry with the date range, on-site location and hours. The location field names the Plaza Convention Center and the hotel supplies its Las Vegas, Nevada street address on the same page. The registered scope covers this entry. [Venue calendar entry](https://www.plazahotelcasino.com/entertainment/downtown-christmas-expo/)

| Publisher | Reported dates | Time evidence | Venue |
| --- | --- | --- | --- |
| Plaza Hotel & Casino | December 3–12, 2026 | Printed hours of 9 a.m.–4:30 p.m. | 3rd Floor, Plaza Convention Center |
| Network in Vegas | December 3–12, 2026 | Start at 8 a.m. December 3 and end at 5 p.m. December 12 | Plaza Hotel & Casino |

The [independent calendar entry](https://networkinvegas.com/event/downtown-christmas-expo/) and venue entry identify the same named edition. The [query](../db/queries/las_vegas_publisher_claims.sql) groups this reviewed pair by edition, keeps both claims, and exposes the recorded hours and dated boundaries individually. Other publisher identities remain separate. Three agreeing pairs previously detected within Network.Vegas remain traceable to both collection scopes.

On November 24 the 90-day query returned 25 rows from 29 listing claims. One row had two independent publishers. The original Network.Vegas query returned 17 rows from 20 claims. Both queries ran under the existing dev read-only role using its base-table privileges.

## Validation and restore drill

Two default-robots, one-page runs of the same Plaza candidate each passed the configured quality gates and delivered a single observation to dev. A repeat delivery skipped both receipts. The Plaza candidate on extraction build `9ee9fc12b93cb1ff2d90adf01fd40556698bf990d7695edbd5c87952d289c223` produced runs `f70d7f77-1f31-493c-84e3-e8984e86ba79` and `f5cad819-00d0-4908-a41b-c586ad7f5966`.

The [restore drill](../scripts/restore-evidence-sample.mjs) read a consistent dev snapshot for page 2 of the second run, staged its seven related rows in local PostgreSQL, and restored a custom-format dump into a fresh database. All seven rows matched. Decompressing the recovered capture produced 184,426 bytes with SHA-256 `5e7491a349bbec6d57fd6d67f16b3130fef8789eae09a26a521223c872596f29`, equal to the page's recorded hash. This exercised logical sample recovery. A full service-backup restore and worker restart remain open.

For the next matching experiment, select a second shared occurrence, retain one similar listing as a negative example, and compare each publisher’s dates, venue, and evidence before broadening the matching rule.
