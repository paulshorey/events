// Chicago: https://www.chicagoparkdistrict.com/events
// Strategy and selectors: sources/registry.json (url-042). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-042', process.argv.slice(2));
