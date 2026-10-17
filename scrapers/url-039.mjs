// Chicago: https://www.choosechicago.com/events/
// Strategy and selectors: sources/registry.json (url-039). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-039', process.argv.slice(2));
