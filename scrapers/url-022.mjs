// Las Vegas: https://events.lasvegascalendars.com/lasvegascalendars/pinboard?tags=Conventions
// Strategy and selectors: sources/registry.json (url-022). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-022', process.argv.slice(2));
