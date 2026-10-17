// New Orleans: https://www.neworleans.com/events/
// Strategy and selectors: sources/registry.json (url-073). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-073', process.argv.slice(2));
