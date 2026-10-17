// Festival and fair directories: https://meetmeatthefair.com/events/all
// Strategy and selectors: sources/registry.json (url-009). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-009', process.argv.slice(2));
