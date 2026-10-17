// Seattle: https://visitseattle.org/things-to-do/events/
// Strategy and selectors: sources/registry.json (url-059). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-059', process.argv.slice(2));
