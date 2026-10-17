// Houston: https://www.houstontx.gov/events/
// Strategy and selectors: sources/registry.json (url-045). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-045', process.argv.slice(2));
