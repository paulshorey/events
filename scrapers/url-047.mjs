// Houston: https://houston.com/events
// Strategy and selectors: sources/registry.json (url-047). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-047', process.argv.slice(2));
