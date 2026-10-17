// Los Angeles: https://lacity.gov/calendar
// Strategy and selectors: sources/registry.json (url-036). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-036', process.argv.slice(2));
