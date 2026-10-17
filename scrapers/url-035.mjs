// Los Angeles: https://www.discoverlosangeles.com/events
// Strategy and selectors: sources/registry.json (url-035). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-035', process.argv.slice(2));
