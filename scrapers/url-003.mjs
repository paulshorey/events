// General event discovery: https://events.com/
// Strategy and selectors: sources/registry.json (url-003). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-003', process.argv.slice(2));
