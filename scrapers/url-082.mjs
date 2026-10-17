// San Diego: https://www.visitsandiego.com/calendar
// Strategy and selectors: sources/registry.json (url-082). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-082', process.argv.slice(2));
