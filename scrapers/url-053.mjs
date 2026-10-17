// Boston: https://www.meetboston.com/events/
// Strategy and selectors: sources/registry.json (url-053). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-053', process.argv.slice(2));
