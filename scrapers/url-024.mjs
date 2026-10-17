// New York City: https://www.nyctourism.com/events/
// Strategy and selectors: sources/registry.json (url-024). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-024', process.argv.slice(2));
