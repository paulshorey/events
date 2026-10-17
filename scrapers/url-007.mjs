// Festival and fair directories: https://festivalindex.com/en-us
// Strategy and selectors: sources/registry.json (url-007). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-007', process.argv.slice(2));
