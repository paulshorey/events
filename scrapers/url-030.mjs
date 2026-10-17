// New York City: https://www.cityguideny.com/events/?catid=182
// Strategy and selectors: sources/registry.json (url-030). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-030', process.argv.slice(2));
