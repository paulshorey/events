// Washington, DC: https://dc.gov/calendar/month
// Strategy and selectors: sources/registry.json (url-052). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-052', process.argv.slice(2));
