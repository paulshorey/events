// Conventions and trade shows: https://tradefest.io/en/tag/research
// Strategy and selectors: sources/registry.json (url-083). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-083', process.argv.slice(2));
