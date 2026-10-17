// Boston: https://www.boston.gov/events
// Strategy and selectors: sources/registry.json (url-054). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-054', process.argv.slice(2));
