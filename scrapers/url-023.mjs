// Las Vegas: https://www.eventbrite.com/d/nv--las-vegas/
// Strategy and selectors: sources/registry.json (url-023). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-023', process.argv.slice(2));
