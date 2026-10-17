// Miami: https://www.miamiandbeaches.com/events
// Strategy and selectors: sources/registry.json (url-056). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-056', process.argv.slice(2));
