// Seattle: https://visitseattle.org/events/?frm=events&event_type=festivals-special-events
// Strategy and selectors: sources/registry.json (url-086). Shared implementation: src/adapters/.
import { scraperMain } from '../src/cli.mjs';
await scraperMain('url-086', process.argv.slice(2));
