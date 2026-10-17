// New Orleans: https://www.neworleans.com/things-to-do/festivals/
// Strategy and selectors: sources/registry.json (url-074). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-074', process.argv.slice(2));
