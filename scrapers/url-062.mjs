// Seattle: https://www.seattle.gov/event-calendar
// Strategy and selectors: sources/registry.json (url-062). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-062', process.argv.slice(2));
