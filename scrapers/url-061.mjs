// Seattle: https://visitseattle.org/about-us/citywide-calendar/
// Strategy and selectors: sources/registry.json (url-061). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-061', process.argv.slice(2));
