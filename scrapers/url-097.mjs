// Orlando: https://events.occc.net/calendar-embed-source/
// Strategy and selectors: sources/registry.json (url-097). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-097', process.argv.slice(2));
