// Festival and fair directories: https://www.countyfairgrounds.net/
// Strategy and selectors: sources/registry.json (url-008). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-008', process.argv.slice(2));
