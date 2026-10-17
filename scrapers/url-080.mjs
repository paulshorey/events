// Orlando: https://www.downtownorlando.com/Fun/Events
// Strategy and selectors: sources/registry.json (url-080). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-080', process.argv.slice(2));
