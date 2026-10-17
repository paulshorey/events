// Atlanta: https://discoveratlanta.com/events/festivals/
// Strategy and selectors: sources/registry.json (url-068). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-068', process.argv.slice(2));
