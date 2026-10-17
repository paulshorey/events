// General event discovery: https://eventfinder.site/
// Strategy and selectors: sources/registry.json (url-004). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-004', process.argv.slice(2));
