// Denver: https://visitdenver.com/events/?filter_categories[0]=63
// Strategy and selectors: sources/registry.json (url-087). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-087', process.argv.slice(2));
