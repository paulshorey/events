import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { load } from 'cheerio';

const args = process.argv.slice(2);
const includeSupplemental = args.includes('--include-supplemental');
const limitArg = args.indexOf('--limit');
const limit = limitArg < 0 ? Infinity : Number(args[limitArg + 1]);
if (!(limit > 0)) throw new Error('--limit must be positive');
const seeds = JSON.parse(await readFile(new URL('../sources/seed-urls.json', import.meta.url)));
const selected = seeds.filter(s => includeSupplemental || s.origin === 'primary-list').slice(0, limit);
await mkdir('.artifacts/recon', { recursive: true });
const findings = [];
const startedAt = new Date().toISOString();

async function probe(seed) {
  const started = Date.now();
  try {
    const response = await fetch(seed.url, {
      signal: AbortSignal.timeout(18000),
      headers: { 'user-agent': 'EventsMiningPrototype/0.1 (bounded public source evaluation)' },
    });
    let html = '';
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (reader) {
      while (html.length < 1_500_000) {
        const chunk = await reader.read();
        if (chunk.done) break;
        html += decoder.decode(chunk.value, { stream: true });
      }
      await reader.cancel();
    }
    const $ = load(html);
    const text = $('body').text().replace(/\s+/g, ' ');
    const platforms = [
      [/simpleview|sv-site|sv-col|assets\.simpleviewinc/i, 'simpleview'],
      [/tribe-events|tribe\/events|tribe_events/i, 'wordpress-the-events-calendar'],
      [/wp-content|wp-json|wordpress/i, 'wordpress'],
      [/drupalSettings|drupal\.org|Drupal\./i, 'drupal'],
      [/trumba\.com|Trumba/i, 'trumba'],
      [/opencities|opencitiesweb|OpenCities/i, 'opencities'],
      [/contentful|ctfassets/i, 'contentful'],
      [/__NEXT_DATA__|\/_next\//i, 'nextjs'],
      [/eventbrite/i, 'eventbrite-reference'],
    ].filter(([re]) => re.test(html)).map(([, name]) => name);
    const jsonLd = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get();
    const result = {
      ...seed, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      statusCode: response.status, finalUrl: response.url, contentType: response.headers.get('content-type'),
      title: $('title').text().trim().slice(0, 250), capturedChars: html.length,
      platforms, jsonLdBlocks: jsonLd.length, hasEventJsonLd: jsonLd.some(s => /"(?:@type)"\s*:\s*(?:"[^"]*Event|\[[^\]]*"Event)/.test(s)),
      likelyChallenge: /just a moment|attention required|access denied|verify you are human|request rejected|captcha/i.test($('title').text() + ' ' + text.slice(0, 1400)),
      eventLinks: $('a[href]').map((_, el) => $(el).attr('href')).get().filter(s => /event|calendar|ical|\.ics|wp-json/i.test(s)).slice(0, 18),
      discoveryOnly: true,
    };
    await writeFile(`.artifacts/recon/${seed.id}.html`, html);
    return result;
  } catch (error) {
    return { ...seed, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      error: { name: error.name, message: error.message, code: error.cause?.code }, discoveryOnly: true };
  }
}

let index = 0;
await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
  for (;;) {
    const seed = selected[index++];
    if (!seed) break;
    const result = await probe(seed);
    findings.push(result);
    console.log(`${seed.id} ${result.statusCode ?? result.error?.code ?? 'ERROR'} ${result.title ?? result.error?.message} ${result.platforms?.join(',') ?? ''}`);
  }
}));
findings.sort((a, b) => a.id.localeCompare(b.id));
const report = { startedAt, finishedAt: new Date().toISOString(), method: 'one bounded HTTP GET per supplied URL; not an extractor or completeness test', findings };
await writeFile('_working/source_reconnaissance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checked: findings.length, accessible: findings.filter(r => r.statusCode >= 200 && r.statusCode < 300 && !r.likelyChallenge).length }));
