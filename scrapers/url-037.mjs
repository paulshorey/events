// Los Angeles: https://www.laconventioncenter.com/events
// Strategy and selectors: sources/registry.json (url-037). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-037', process.argv.slice(2));
