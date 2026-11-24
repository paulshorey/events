# TISE 2027 and full dev recovery rehearsal

November 24, 2026.

## Which dates belong to TISE?

| Publisher | Stated dates for 2027 | Venue or location evidence |
| --- | --- | --- |
| Network.Vegas, general and convention scopes | February 1–5 | Neither listing supplies location fields. Both refer to publisher ID 59573. |
| Network in Vegas | February 1–4 | Mandalay Bay Convention Center, Las Vegas, NV. Publisher ID 2397. |
| TISE organizer | Education February 1–4, exhibit hall February 2–4 | Mandalay Bay Convention Center. [Organizer calendar](https://www.intlsurfaceevent.com/) |
| Pink27 organizer | February 1–4 | Bellagio Hotel, Las Vegas. [Organizer FAQ](https://pinkelephant.com/en-US/Pink27/faq) |

The organizer documents two programs ending February 4. The reason for Network.Vegas’s February 5 date is unknown. The discovery query keeps that claim visible, reports a February 1 listing start, and leaves the summary end date null. Each of the three listing claims retains its own capture and location fields. Only the independently located directory claim establishes the city for this reviewed edition. [Network.Vegas listing](https://network.vegas/calendar/the-international-surface-event-tise-2027/) · [Network in Vegas listing](https://networkinvegas.com/event/tise-surfaces-expo/)

Pink27 appears separately. Its two Network.Vegas listing scopes share publisher ID 56557. Their structured city fields are empty and their published Bellagio street address contains Las Vegas, NV 89109. Matching checks publisher, native ID, event URL and edition year. Similar titles or equal dates do not create cross-publisher links.

On the November 24 dev snapshot the [90-day query](../db/queries/las_vegas_publisher_claims.sql) returned **26 rows from 33 listing claims** under the read-only role. Two rows had independent publishers, the Plaza Expo and TISE. All five TISE and Pink27 listing claims had retrievable capture bytes in dev. The local [SQL regression](../tests/las-vegas-publisher-claims.test.mjs) exercises conflicting dates, a changed URL, the annual-edition boundary, and the loss of the independent location claim.

Both organizer pages were inspected once under the default robots policy. The TISE HTML had SHA-256 `d0156d0ba673c9542605d4edaede7653b8d43c12316a3a5896f962d7ec92f84f`. The Pink27 HTML had SHA-256 `775b46dbfe0909cc0b0997a7bf51721a546a3bc4646c83c06b38ecdbcc370373`. These diagnostic captures are held locally under `.artifacts/collection/tise-edition-2026-11-24/`. The report query uses delivered listing captures. The organizer pages provide additional dated context for this review.

## Recovery results

The [full logical drill](../scripts/rehearse-database-restore.mjs) exported a repeatable-read snapshot of dev, passed it to PostgreSQL 18 pg_dump, and restored the resulting custom archive into a new local database. The local PostgreSQL process used peer authentication on an owner-only Unix socket. Counts matched in all 12 public tables, including 225,390 source observations, 345 extraction runs and 709 receipts. All 15,316 stored captures decompressed to their recorded lengths and SHA-256 values. There were zero metadata-only captures. The archive was 897,230,713 bytes. Setup, source counts and dump took 42 seconds, restore took 30 seconds, and verification took 13 seconds. A separate SIGTERM during a dump confirmed that the temporary cluster stopped and the private directory was cleared.

The worker rehearsal started the real CLI against a two-page loopback publisher using a disposable SQLite journal. The first page committed. While the publisher held the second request open, the CLI was killed. After the normal lease expired, CLI recovery fenced out the old token and the replacement CLI completed the run. The publisher saw pages 1, 2, 2. The two saved capture hashes verified, two observations remained, and recovery from the kill took 59.7 seconds including lease expiry. The local result is under `.artifacts/collection/tise-edition-2026-11-24/worker.json`.

These exercises cover the logical application database and a local worker restart. Original server roles and grants, hosted supervision and the Railway volume cutover remain separate operational checks. The provider's snapshot restore stages a replacement volume at the original service mount in the same environment. [Railway volume backup documentation](https://docs.railway.com/volumes/backups)
