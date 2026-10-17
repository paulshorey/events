// Conventions and trade shows: https://10times.com/
// Strategy and selectors: sources/registry.json (url-011). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-011', process.argv.slice(2));
