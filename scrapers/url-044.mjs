// Houston: https://www.visithoustontexas.com/events/annual-events/
// Strategy and selectors: sources/registry.json (url-044). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-044', process.argv.slice(2));
