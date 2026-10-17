// New York City: https://dothisnyc.com/street-fairs-nyc/
// Strategy and selectors: sources/registry.json (url-033). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-033', process.argv.slice(2));
