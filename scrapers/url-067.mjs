// Atlanta: https://discoveratlanta.com/events/all/
// Strategy and selectors: sources/registry.json (url-067). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-067', process.argv.slice(2));
