// Dallas: https://www.visitdallas.com/events/
// Strategy and selectors: sources/registry.json (url-070). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-070', process.argv.slice(2));
