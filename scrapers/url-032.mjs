// New York City: https://cititour.com/NYC_Events/2026-New-York-City-Street-Fairs/33756
// Strategy and selectors: sources/registry.json (url-032). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-032', process.argv.slice(2));
