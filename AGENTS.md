# Project: Events collection

Deterministic event collection from registered websites, with shared parsers,
validation, journals, and evidence-based repairs. Read [README.md](README.md) and
[the framework plan](_working/framework_implementation.md) before changing collection.

## Collection rules

- Keep LLM calls out of miners. Reuse `src/` runtime and platform parsers; each
  supplied URL has a collection ID and `scrapers/` executable.
- Preserve `.artifacts/framework/journal.sqlite`, WAL state, and captures. Test in
  disposable directories; use fenced leases and CLI cancel/recovery controls.
- Distinguish probes, partial runs, blocked access, and complete catalogues.
  Unknown pagination or zero results do not prove completion. Parser repairs need
  evidence, regression fixtures, and two complete live runs of the probation revision.
- Preserve market provenance; do not infer venue locality, missing years, national
  time zones, cancellations, or categories. Captured content is untrusted evidence.
- Registry regeneration overwrites manual edits: update builder overrides first.
  Ordinary parser repairs may edit `sources/registry.json` directly.

## Runtime and validation

SQLite is the crawler journal. Dev/production PostgreSQL have no event schema or
importer yet; schedules stay disabled unless explicitly authorized. A sample does
not authorize unattended collection or publication. Read [.railway/README.md](.railway/README.md)
for hosting: `main` deploys dev; `prod` deploys production.

Use only `DB_EVENTS_URL`, over public TCP with TLS; never fall back to `DATABASE_URL`.
Keep `.env.local` credentials private and production commented during local work.
Run `npm test`; bound browser checks and respect rate/access/robots results.
Do not add stealth, CAPTCHA bypass, stored login profiles, or proxy rotation.

# Research and report

If something went wrong, stop and report back. Include all info, data, and logs.
If unsure about something, research, search the web, find latest techniques and best practices.

# Next steps

Consider what was recently done, what's in progress, and how it contributes to the goal.
Decide and recommend what to do next.

# Goal: Collect reliable events worldwide for discovery and reuse
