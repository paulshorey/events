// New York City: https://www.nycgovparks.org/events/festivals/ajax/aggregate/p1
// Strategy and selectors: sources/registry.json (url-085). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-085', process.argv.slice(2));
