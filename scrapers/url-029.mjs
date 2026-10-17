// New York City: https://www.nyc.com/events/
// Strategy and selectors: sources/registry.json (url-029). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-029', process.argv.slice(2));
