// Orlando: https://www.wyndhamidriveresort.com/orange-county-convention-center.htm
// Strategy and selectors: sources/registry.json (url-092). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-092', process.argv.slice(2));
