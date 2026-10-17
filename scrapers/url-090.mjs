// Orlando: https://conventioncalendar.com/us/fl/orlando/orange-county-convention-center
// Strategy and selectors: sources/registry.json (url-090). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-090', process.argv.slice(2));
