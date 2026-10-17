// Las Vegas: https://www.vegasmeansbusiness.com/destination-calendar/?bounds=false&view=grid&sort=date&filter_date_start=1/1/2026&filter_date_end=1/31/2026
// Strategy and selectors: sources/registry.json (url-084). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-084', process.argv.slice(2));
