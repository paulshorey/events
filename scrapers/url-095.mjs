// Orlando: https://www.visitorlando.city/events
// Strategy and selectors: sources/registry.json (url-095). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-095', process.argv.slice(2));
