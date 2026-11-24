import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connect, migrate } from "../src/storage/postgres.mjs";
import { disposableDatabase } from "./helpers/postgres.mjs";

const query = (
  await readFile(
    new URL(
      "../db/queries/new_york_javits_publisher_claims.sql",
      import.meta.url,
    ),
    "utf8",
  )
).replace(
  "(CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date",
  "DATE '2026-11-24'",
);
const venueRun = "05903d9f-7a21-4d81-9de4-28cbac16183d";
const directoryRun = "18b2a71c-f077-464f-9f63-8f8bfada575c";
const venueId = "event-59155|2027-01-20";
const otherId = "event-60965|2027-01-20";
const directoryId = "conventioncalendar:420414|2027-01-20";
const directoryUrl =
  "https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center/discover-boating-new-york-boat-show-1-420414";

test("the reviewed Boat Show edition and the same-day TravMedia event remain traceable to distinct source records", async (t) => {
  const url = await disposableDatabase();
  if (!url) return t.skip("Disposable PostgreSQL unavailable");
  const db = await connect(url);
  t.after(() => db.end());
  await migrate(db);
  // Use the real column types with a small controlled set of delivered rows.
  for (const table of ["extraction_runs", "source_observations", "run_pages"])
    await db.query(
      `CREATE TEMP TABLE ${table} AS TABLE public.${table} WITH NO DATA`,
    );
  await db.query(
    `INSERT INTO extraction_runs(id,collection_id,source_key,status,created_at,journal_updated_at)
    VALUES ($1,'url-027','javitscenter.com','complete','2026-11-05','2026-11-05'),
           ($2,'url-028','conventioncalendar.com','complete','2026-11-05','2026-11-05'),
           ('ffffffff-ffff-ffff-ffff-ffffffffffff','url-027','javitscenter.com','partial','2026-11-24','2026-11-24')`,
    [venueRun, directoryRun],
  );
  await db.query(
    `INSERT INTO run_pages(run_id,page_id,url,content_hash)
    VALUES ($1,63,'https://www.javitscenter.com/calendar#events-miner-month=2','venue-hash'),
           ($2,1410,'https://conventioncalendar.com/calendar','directory-hash')`,
    [venueRun, directoryRun],
  );
  await db.query(
    "UPDATE extraction_runs SET options=jsonb_build_object('ignoreRobots',true)",
  );
  async function listing(run, id, title, eventUrl, end) {
    const venue = run === venueRun;
    const payload = {
      sourceRecordId: id,
      location: {
        venue: venue
          ? "Jacob K. Javits Convention Center"
          : "Jacob Javits Center",
        locality: venue ? "New York" : "New York City",
        region: "NY",
        country: "US",
      },
      evidence: {
        url: venue
          ? "https://www.javitscenter.com/api/momentus/events?startDate=2027-01-01&endDate=2027-01-31"
          : "https://conventioncalendar.com/calendar",
      },
    };
    await db.query(
      `INSERT INTO source_observations(run_id,collection_id,page_id,record_key,payload,title,event_url,start_date,end_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,'2027-01-20',$8)`,
      [
        run,
        venue ? "url-027" : "url-028",
        venue ? 63 : 1410,
        id,
        payload,
        title,
        eventUrl,
        end,
      ],
    );
  }
  await listing(
    venueRun,
    venueId,
    "DISCOVER BOATING NEW YORK BOAT SHOW",
    "https://www.javitscenter.com/calendar#event-59155",
    "2027-01-24",
  );
  await listing(
    venueRun,
    otherId,
    "TRAVMEDIA'S INTERNATIONAL MEDIA MARKETPLACE (IMM) USA",
    "https://www.javitscenter.com/calendar#event-60965",
    "2027-01-21",
  );
  await listing(
    directoryRun,
    directoryId,
    "Discover Boating New York Boat Show",
    directoryUrl,
    "2027-01-24",
  );
  const report = async () => (await db.query(query)).rows;
  const rows = await report();
  assert.equal(rows.length, 2);
  const reviewed = rows.find((r) => r.publishers === "2");
  assert.deepEqual(reviewed.occurrence, [
    "discover-boating-new-york-boat-show",
    2027,
  ]);
  assert.deepEqual(
    reviewed.source_claims.map((c) => [c.publisher_id, c.end_date, c.sha256]),
    [
      [venueId, "2027-01-24", "venue-hash"],
      [directoryId, "2027-01-24", "directory-hash"],
    ],
  );
  assert.ok(
    reviewed.source_claims.every((claim) => claim.ignore_robots === true),
  );
  assert.match(
    reviewed.source_claims[0].capture_url,
    /\/api\/momentus\/events/,
  );
  assert.equal(
    rows.find((r) => r.publishers === "1").source_claims[0].publisher_id,
    otherId,
  );

  // Even identical titles and date ranges at the same venue cannot merge new IDs.
  await db.query(
    "UPDATE source_observations SET title='Discover Boating New York Boat Show',end_date='2027-01-24' WHERE record_key=$1",
    [otherId],
  );
  assert.equal((await report()).length, 2);
  for (const end of ["2027-01-25", null]) {
    await db.query(
      "UPDATE source_observations SET end_date=$1 WHERE record_key=$2",
      [end, directoryId],
    );
    const edition = (await report()).find((r) => r.publishers === "2");
    assert.equal(edition.end_date, null);
    assert.deepEqual(
      edition.source_claims.map((c) => c.end_date),
      ["2027-01-24", end],
    );
  }
  await db.query(
    "UPDATE source_observations SET event_url=event_url||'-other' WHERE record_key=$1",
    [directoryId],
  );
  assert.deepEqual(
    (await report()).map((r) => r.publishers),
    ["1", "1", "1"],
  );
  await db.query(
    "UPDATE source_observations SET event_url=$1,payload=payload #- '{location,locality}' WHERE record_key=$2",
    [directoryUrl, directoryId],
  );
  assert.deepEqual(
    (await report()).map((r) => r.publishers),
    ["1", "1"],
  );
});
