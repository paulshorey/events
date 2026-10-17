import { writeFile } from "node:fs/promises";
import { Journal } from "../src/storage/journal.mjs";
const journal = new Journal();
try {
  const collections = [];
  for (const c of journal.list()) {
    const run = c.last_attempt && journal.run(c.last_attempt);
    if (!run?.result?.recordCount) continue;
    const events = journal
      .records(run.id)
      .filter((r) => (r.endDate ?? r.startDate) >= run.options.asOf)
      .slice(0, 2);
    collections.push({
      collectionId: c.id,
      sourceUrl: c.config.url,
      group: c.config.group,
      marketCity: c.config.cityMarket,
      status: run.status,
      complete: run.result.complete,
      runId: run.id,
      build: run.options.buildId,
      availableObservations: run.result.recordCount,
      events,
    });
  }
  const output = "_working/framework_event_samples.json";
  await writeFile(
    output,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        purpose:
          "Bounded review samples; overlapping observations, not canonical unique events",
        perCollectionLimit: 2,
        collections,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      output,
      collections: collections.length,
      samples: collections.reduce((n, c) => n + c.events.length, 0),
    }),
  );
} finally {
  journal.close();
}
