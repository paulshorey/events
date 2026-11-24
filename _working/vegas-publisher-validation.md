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

The final Plaza candidate on extraction build `6dd62ba552dd6d47570bceb1a1ed7cffa73c07c03f86ecf026e15bd665ba68e5` and config revision `630f374219089fc5e6235b57b9c59265895eee7b4fffa7030db46cc8b6519353` completed two default-robots runs with one page and one observation per run. Both passed quality checks and emitted `parser-validated` observations. Dev delivery wrote receipts 708 and 709, and a repeat delivery skipped both.

| Pass | Complete run ID | Dev receipt |
| --- | --- | --- |
| 1 | `4691f8b4-f0f3-48d6-9765-61a94063c4b4` | `708` |
| 2 | `d6f6d4ee-4251-4779-8e28-f6870676f747` | `709` |

Both read-only queries reproduced the counts above after delivery. The cross-publisher comparison selected the newer Plaza run and retained both publishers’ capture hashes and their distinct time claims.

The [restore drill](../scripts/restore-evidence-sample.mjs) read a consistent dev snapshot for page 2 of the second run, staged its seven related rows in local PostgreSQL, and restored a custom-format dump into a fresh database. All seven rows matched. Decompressing the recovered capture produced 193,282 bytes with SHA-256 `21137dedf3bab528a0cff87392acbcdc420e5e0dd2fc3c01c97ed5ba8bcbff0f`, equal to the page’s recorded hash and the hash reported by the discovery query. The subsequent [full logical restore and worker restart](tise-and-recovery.md) extended this sample drill.

The earlier build `9ee9fc12b93cb1ff2d90adf01fd40556698bf990d7695edbd5c87952d289c223` also passed runs `f70d7f77-1f31-493c-84e3-e8984e86ba79` and `f5cad819-00d0-4908-a41b-c586ad7f5966`. Its second run previously restored a 184,426-byte capture with SHA-256 `5e7491a349bbec6d57fd6d67f16b3130fef8789eae09a26a521223c872596f29`.

The first integrated build `76cc7615b0527356820dd5471971e74f9870fd97d3162ff5d1f912a7212dddcd` also passed runs `38119121-42f0-4da4-8e8a-719aa6013d4b` and `3049b7f6-ecaf-436f-933a-a94edd93f960` with dev receipts 706 and 707. Its second run restored a 184,656-byte capture with SHA-256 `925f246b632dd0488f8d28e4c19a8549f7b58b8d603fa2c56c454a38cc1c9bfd`.

The [TISE matching experiment](tise-and-recovery.md) added a second shared occurrence and used Pink27 as a same-date negative example.
