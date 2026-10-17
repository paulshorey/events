// Chicago: https://www.chicago.gov/city/en/sites/chicagoriverwalk/home/events.html
// Strategy and selectors: sources/registry.json (url-093). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-093', process.argv.slice(2));
