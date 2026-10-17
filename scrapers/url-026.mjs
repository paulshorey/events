// New York City: https://www.nycgovparks.org/events/festivals
// Strategy and selectors: sources/registry.json (url-026). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-026', process.argv.slice(2));
