// Seattle: https://www.seattle.gov/special-events/plan-an-event/calendar
// Strategy and selectors: sources/registry.json (url-063). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-063', process.argv.slice(2));
