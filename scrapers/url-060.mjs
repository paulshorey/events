// Seattle: https://visitseattle.org/things-to-do/events/festivals/
// Strategy and selectors: sources/registry.json (url-060). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-060', process.argv.slice(2));
