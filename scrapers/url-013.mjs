// Conventions and trade shows: https://conventiongrid.com/calendar/
// Strategy and selectors: sources/registry.json (url-013). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-013', process.argv.slice(2));
