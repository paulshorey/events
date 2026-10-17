// Washington, DC: https://washington.org/press/journalist-newsletter/calendar-events
// Strategy and selectors: sources/registry.json (url-050). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-050', process.argv.slice(2));
