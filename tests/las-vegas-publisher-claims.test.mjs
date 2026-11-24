import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connect } from "../src/storage/postgres.mjs";
import { disposableDatabase } from "./helpers/postgres.mjs";

// Only the report clock is pinned. The tested joins and filters come from the
// discovery query. Fixture identities, dates and places are from the dev captures.
const query = (
  await readFile(
    new URL("../db/queries/las_vegas_publisher_claims.sql", import.meta.url),
    "utf8",
  )
).replace(
  "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date",
  "DATE '2027-02-01'",
);

test("TISE keeps disputed dates and source locality; Pink27 is a separate edition", async (t) => {
  const url = await disposableDatabase();
  if (!url) return t.skip("Disposable PostgreSQL unavailable");
  const db = await connect(url);
  t.after(() => db.end());
  await db.query(`
    CREATE TEMP TABLE extraction_runs(id int, collection_id text, source_key text, status text, journal_updated_at int, created_at int);
    CREATE TEMP TABLE source_observations(run_id int, collection_id text, record_key text, page_id int, payload jsonb,
      title text, event_url text, start_date date, end_date date, start_local text, end_local text, time_zone text);
    CREATE TEMP TABLE run_pages(run_id int, page_id int, url text, content_hash text);
    INSERT INTO extraction_runs VALUES (1,'url-019','network.vegas','complete',1,1),(2,'url-020','network.vegas','complete',2,2),
      (3,'url-021','networkinvegas.com','complete',3,3),(4,'url-021','networkinvegas.com','partial',4,4);
    INSERT INTO run_pages SELECT id,1,'https://example.test/'||id,'capture-'||id FROM extraction_runs;
  `);
  async function add(run, id, title, eventUrl, endDate, location) {
    await db.query(
      `INSERT INTO source_observations SELECT id,collection_id,$2,1,$3::jsonb,$4,$5,
      DATE '2027-02-01',$6::date,NULL,NULL,'America/Los_Angeles' FROM extraction_runs WHERE id=$1`,
      [
        run,
        id,
        JSON.stringify({ sourceRecordId: id, location }),
        title,
        eventUrl,
        endDate,
      ],
    );
  }
  const tiseNetwork =
    "https://network.vegas/calendar/the-international-surface-event-tise-2027/";
  for (const run of [1, 2]) {
    await add(
      run,
      "59573",
      "The International Surface Event – TISE 2027",
      tiseNetwork,
      "2027-02-05",
      null,
    );
    await add(
      run,
      "56557",
      "Pink27",
      "https://network.vegas/calendar/pink27/",
      "2027-02-04",
      {
        venue: "Bellagio",
        streetAddress: "3600 Las Vegas Blvd. S. Las Vegas, NV 89109",
      },
    );
  }
  const venue = {
    venue: "Mandalay Bay Convention Center",
    locality: "Las Vegas",
    region: "NV",
    country: "United States",
  };
  await add(
    3,
    "2397",
    "TISE: Surfaces Expo",
    "https://networkinvegas.com/event/tise-surfaces-expo/",
    "2027-02-04",
    venue,
  );
  const rows = (await db.query(query)).rows;
  assert.equal(rows.length, 2);
  const expo = rows.find(
    (r) => r.occurrence[0] === "international-surface-event",
  );
  assert.equal(expo.publishers, "2");
  assert.equal(expo.end_date, null);
  assert.deepEqual(
    expo.source_claims.map((c) => [c.end_date, c.city_evidence, c.sha256]),
    [
      ["2027-02-05", null, "capture-1"],
      ["2027-02-05", null, "capture-2"],
      ["2027-02-04", "venue address fields", "capture-3"],
    ],
  );
  const pink = rows.find((r) => r.title === "Pink27");
  assert.equal(pink.publishers, "1");
  assert.equal(pink.source_claims.length, 2);

  // An ID reused at a different URL must not vouch for the location-less records.
  await db.query(
    "UPDATE source_observations SET event_url='https://example.test/new-edition' WHERE run_id=3",
  );
  assert.ok(
    (await db.query(query)).rows.every(
      (r) => r.occurrence[0] !== "international-surface-event",
    ),
  );
  await db.query(
    "UPDATE source_observations SET event_url='https://networkinvegas.com/event/tise-surfaces-expo/' WHERE run_id=3",
  );
  // A repeated annual directory URL alone cannot establish another year's edition.
  await db.query(
    "UPDATE source_observations SET start_date=start_date+365,end_date=end_date+365",
  );
  assert.ok(
    (
      await db.query(query.replace("DATE '2027-02-01'", "DATE '2028-02-01'"))
    ).rows.every((r) => r.occurrence[0] !== "international-surface-event"),
  );
});
