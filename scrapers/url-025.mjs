// New York City: https://www.nyctourism.com/things-to-do/events-and-festivals/
// Strategy and selectors: sources/registry.json (url-025). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-025', process.argv.slice(2));
