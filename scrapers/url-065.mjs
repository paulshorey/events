// San Francisco: https://portal.sftravel.com/calendar_public/home_sfdc.cfm
// Strategy and selectors: sources/registry.json (url-065). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-065', process.argv.slice(2));
