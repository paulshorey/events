// Seattle: https://visitseattle.org/events/
// Strategy and selectors: sources/registry.json (url-058). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-058', process.argv.slice(2));
