// Denver: https://visitdenver.com/events/
// Strategy and selectors: sources/registry.json (url-076). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-076', process.argv.slice(2));
