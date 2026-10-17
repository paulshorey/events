// Los Angeles: https://www.laconventioncenter.com/events/all
// Strategy and selectors: sources/registry.json (url-038). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-038', process.argv.slice(2));
