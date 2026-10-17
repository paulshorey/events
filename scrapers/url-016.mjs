// Las Vegas: https://www.vegasmeansbusiness.com/destination-calendar/
// Strategy and selectors: sources/registry.json (url-016). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-016', process.argv.slice(2));
