// General event discovery: https://www.eventbrite.com/
// Strategy and selectors: sources/registry.json (url-001). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-001', process.argv.slice(2));
