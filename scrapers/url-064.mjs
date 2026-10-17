// San Francisco: https://www.sftravel.com/explore/events
// Strategy and selectors: sources/registry.json (url-064). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-064', process.argv.slice(2));
