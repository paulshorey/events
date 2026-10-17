// Las Vegas: https://network.vegas/calendar/category/event-type/convention/
// Strategy and selectors: sources/registry.json (url-020). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-020', process.argv.slice(2));
