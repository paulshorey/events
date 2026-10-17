// New York City: https://www.eventbrite.com/d/ny--new-york/
// Strategy and selectors: sources/registry.json (url-034). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-034', process.argv.slice(2));
