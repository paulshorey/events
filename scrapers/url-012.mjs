// Conventions and trade shows: https://tradefest.io/
// Strategy and selectors: sources/registry.json (url-012). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-012', process.argv.slice(2));
