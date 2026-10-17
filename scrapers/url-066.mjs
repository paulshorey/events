// San Francisco: https://www.sf.gov/departments--office-mayor/events/calendar
// Strategy and selectors: sources/registry.json (url-066). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-066', process.argv.slice(2));
