// Chicago: https://www.chicago.gov/city/en/depts/dca/provdrs/chicago_festivals.html
// Strategy and selectors: sources/registry.json (url-040). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-040', process.argv.slice(2));
