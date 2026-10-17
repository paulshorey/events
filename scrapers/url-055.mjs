// Boston: https://www.boston.gov/departments/tourism-sports-and-entertainment
// Strategy and selectors: sources/registry.json (url-055). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-055', process.argv.slice(2));
