// Las Vegas: https://www.lasvegasnevada.gov/Residents/Arts-Culture/Annual-Festivals
// Strategy and selectors: sources/registry.json (url-018). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-018', process.argv.slice(2));
