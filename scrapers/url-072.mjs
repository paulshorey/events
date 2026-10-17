// Dallas: https://dallascityhall.com/calendar/Pages/default.aspx
// Strategy and selectors: sources/registry.json (url-072). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-072', process.argv.slice(2));
