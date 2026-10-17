// Orlando: https://www.ramadaorlando.com/orange-county-convention-center-events/
// Strategy and selectors: sources/registry.json (url-089). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-089', process.argv.slice(2));
