// Chicago: https://www.chicago.gov/city/en/depts/dca/provdrs/attractions_eventsandexhibitions.html
// Strategy and selectors: sources/registry.json (url-041). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-041', process.argv.slice(2));
