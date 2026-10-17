// Orlando: https://events.occc.net/
// Strategy and selectors: sources/registry.json (url-081). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-081', process.argv.slice(2));
