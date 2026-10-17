// Washington, DC: https://washington.org/find-dc-listings/dc-events
// Strategy and selectors: sources/registry.json (url-049). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-049', process.argv.slice(2));
