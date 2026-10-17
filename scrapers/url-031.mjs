// New York City: https://nycstreetfairs.com/
// Strategy and selectors: sources/registry.json (url-031). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-031', process.argv.slice(2));
