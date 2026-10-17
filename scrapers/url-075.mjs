// New Orleans: https://www.neworleans.com/events/year-at-a-glance/
// Strategy and selectors: sources/registry.json (url-075). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-075', process.argv.slice(2));
