// New York City: https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center
// Strategy and selectors: sources/registry.json (url-028). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-028', process.argv.slice(2));
