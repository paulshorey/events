// Denver: https://visitdenver.com/things-to-do/festivals-events/
// Strategy and selectors: sources/registry.json (url-077). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-077', process.argv.slice(2));
