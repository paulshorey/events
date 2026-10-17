// Chicago: https://events.uchicago.edu/
// Strategy and selectors: sources/registry.json (url-096). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-096', process.argv.slice(2));
