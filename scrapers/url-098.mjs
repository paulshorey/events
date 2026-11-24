// Las Vegas: https://www.plazahotelcasino.com/entertainment/downtown-christmas-expo/
// Strategy and selectors: sources/registry.json (url-098). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-098', process.argv.slice(2));
