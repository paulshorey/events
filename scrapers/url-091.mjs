// Orlando: https://www.occc.net/About-Us-Media-Relations-Press-Releases
// Strategy and selectors: sources/registry.json (url-091). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-091', process.argv.slice(2));
