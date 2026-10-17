// Las Vegas: https://www.vegas.com/las-vegas-events/festivals-in-las-vegas/
// Strategy and selectors: sources/registry.json (url-017). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-017', process.argv.slice(2));
