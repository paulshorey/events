// New York City: https://www.javitscenter.com/calendar
// Strategy and selectors: sources/registry.json (url-027). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-027', process.argv.slice(2));
