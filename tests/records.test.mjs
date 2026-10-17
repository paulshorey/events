import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeUrl, recordFromJsonLd } from "../src/records.mjs";

const config = {
  id: "test",
  url: "https://example.test/events/",
  sourceKey: "example.test",
  group: "Boston",
  categoryHints: [],
};
const evidence = { url: config.url };
const event = JSON.parse(
  await readFile(new URL("fixtures/jsonld-null-fields.json", import.meta.url)),
);
const fallbackEvent = JSON.parse(
  await readFile(new URL("fixtures/jsonld-url-fallback.json", import.meta.url)),
);

test("unusable optional url values fall back to a usable JSON-LD @id", () => {
  for (const url of [
    undefined,
    null,
    "",
    "   ",
    {},
    42,
    false,
    "javascript:alert(1)",
    "http://[",
  ]) {
    const record = recordFromJsonLd(
      config,
      { ...fallbackEvent, url },
      evidence,
    );
    assert.ok(record, "a usable canonical identifier retains the event");
    assert.equal(record.url, fallbackEvent["@id"]);
    assert.equal(record.raw.url, url);
  }
  const record = recordFromJsonLd(
    config,
    { ...fallbackEvent, url: "/event/preferred" },
    evidence,
  );
  assert.equal(record.url, "https://example.test/event/preferred");
});

test("missing links cannot become plausible /undefined or /null event URLs", () => {
  for (const missing of [undefined, null, "", "   ", {}, 42]) {
    assert.equal(safeUrl(missing, config.url), null);
    assert.equal(
      recordFromJsonLd(config, { ...event, url: missing }, evidence),
      null,
    );
  }
  assert.equal(safeUrl("/event/1", config.url), "https://example.test/event/1");
});

test("null optional JSON-LD identity and country retain an otherwise valid event", () => {
  const record = recordFromJsonLd(config, event, evidence);
  assert.equal(record.title, event.name);
  assert.equal(record.location.locality, "Boston");
  assert.equal(record.location.country, null);
  assert.equal(record.raw.identifier, null);
  assert.equal(record.url, event.url);
  const withId = recordFromJsonLd(
    config,
    { ...event, identifier: { value: "fair-1" } },
    evidence,
  );
  assert.equal(withId.sourceRecordId, "fair-1|2026-10-18");
});
