// Orlando: https://www.orlando.gov/Events
// Strategy and selectors: sources/registry.json (url-079). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-079', process.argv.slice(2));
