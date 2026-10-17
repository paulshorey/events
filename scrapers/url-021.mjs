// Las Vegas: https://networkinvegas.com/calendar/
// Strategy and selectors: sources/registry.json (url-021). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-021', process.argv.slice(2));
