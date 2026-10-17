// Houston: https://houston.com/festivals
// Strategy and selectors: sources/registry.json (url-048). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-048', process.argv.slice(2));
