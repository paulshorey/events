// Festival and fair directories: https://festivalnet.com/
// Strategy and selectors: sources/registry.json (url-005). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-005', process.argv.slice(2));
