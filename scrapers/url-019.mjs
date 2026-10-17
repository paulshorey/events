// Las Vegas: https://network.vegas/calendar/
// Strategy and selectors: sources/registry.json (url-019). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-019', process.argv.slice(2));
