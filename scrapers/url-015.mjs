// Conventions and trade shows: https://conventioncalendar.com/
// Strategy and selectors: sources/registry.json (url-015). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-015', process.argv.slice(2));
