// Atlanta: https://www.atlantaga.gov/government/mayor-s-office/executive-offices/office-of-communications/city-calendar
// Strategy and selectors: sources/registry.json (url-069). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-069', process.argv.slice(2));
