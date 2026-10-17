// Festival and fair directories: https://festivaltrekker.com/
// Strategy and selectors: sources/registry.json (url-006). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-006', process.argv.slice(2));
