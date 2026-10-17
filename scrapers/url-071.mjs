// Dallas: https://www.visitdallas.com/events/annual-events/
// Strategy and selectors: sources/registry.json (url-071). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-071', process.argv.slice(2));
