// General event discovery: https://allevents.in/
// Strategy and selectors: sources/registry.json (url-002). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-002', process.argv.slice(2));
