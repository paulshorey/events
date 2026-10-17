// Orlando: https://expofp.com/orange-county-convention-center
// Strategy and selectors: sources/registry.json (url-088). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-088', process.argv.slice(2));
