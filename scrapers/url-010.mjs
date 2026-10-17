// Conventions and trade shows: https://www.tsnn.com/trade-show-calendar
// Strategy and selectors: sources/registry.json (url-010). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-010', process.argv.slice(2));
