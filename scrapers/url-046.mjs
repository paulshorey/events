// Houston: https://www.houstontx.gov/abouthouston/annualevents.html
// Strategy and selectors: sources/registry.json (url-046). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-046', process.argv.slice(2));
