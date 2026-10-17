// Houston: https://www.visithoustontexas.com/events/
// Strategy and selectors: sources/registry.json (url-043). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-043', process.argv.slice(2));
