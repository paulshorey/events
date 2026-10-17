// Conventions and trade shows: https://thetradeshowcalendar.com/ttn/index.php
// Strategy and selectors: sources/registry.json (url-014). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-014', process.argv.slice(2));
