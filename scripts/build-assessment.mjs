import { readFile, writeFile, readdir } from 'node:fs/promises';

const seeds=JSON.parse(await readFile('sources/seed-urls.json'));
const recon=JSON.parse(await readFile('_working/source_reconnaissance.json'));
const byId=new Map(recon.findings.map(row=>[row.id,row]));
const browserById=new Map();
for(const dir of await readdir('.artifacts/browser-probes').catch(()=>[])){
  try{
    const row=JSON.parse(await readFile(`.artifacts/browser-probes/${dir}/inspection.json`));
    row.artifactDir=`.artifacts/browser-probes/${dir}`;
    if(!browserById.has(row.id)||browserById.get(row.id).checkedAt<row.checkedAt)browserById.set(row.id,row);
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
const descriptions={
  'url-001':['discovery hub','Inspect city-result pages; verify available official API access before promising national enumeration.'],
  'url-003':['marketing / discovery hub','Locate an actual public event feed or discovery section; homepage marketing is not an event dataset.'],
  'url-012':['discovery hub','Root redirected to /en/home and promotes booth-design companies; use event-specific sections and validate relevance.'],
  'url-015':['discovery hub','Develop one ConventionCalendar adapter, then configure venue collections for New York and Orlando.'],
  'url-019':['tested collection','Public TEC API returned 10 records across two pages; reuse for category subset instead of scraping twice.'],
  'url-020':['overlapping category view','Use source-level acquisition with upstream category tags; validate category filtering against this view.'],
  'url-024':['collection candidate','Compare overlap with the NYC events/festivals guide; discover actual query and pagination.'],
  'url-025':['editorial / discovery guide','Use as event/detail-page discovery; do not assume all guide entries are dated occurrences.'],
  'url-027':['browser collection candidate','Ordinary Playwright navigation returned HTTP 200 after raw HTTP 429; no extractor implemented yet.'],
  'url-037':['overlapping listing','Use /events/all as the source collection; root listing is a smaller view.'],
  'url-038':['tested collection','Playwright found 31 cards; exported 8 dated sample records; details and complete enumeration remain.'],
  'url-041':['editorial / discovery guide','Follow links to dated event calendars; distinguish exhibitions and attractions from occurrences.'],
  'url-045':['selected-event index','Title describes selected events/venues; assess actual dates and outbound event pages before treating it as complete.'],
  'url-050':['press / editorial calendar','Evaluate date horizon and overlap with the main DC listings; secondary discovery source.'],
  'url-054':['tested collection','Playwright extracted 35 records from two pages; visible date groups and recurring node/date keys validated.'],
  'url-055':['department information','Use for discovering department calendars; not an independent feed by default.'],
  'url-058':['overlapping listing','Compare archive with main Seattle event search and choose one authoritative enumeration route.'],
  'url-061':['convention collection candidate','May have a different audience and date horizon from public events; keep a separate collection if verified.'],
  'url-062':['embedded calendar','HTML includes Trumba; browser probe received 403. Investigate published embed/feed access, not stealth retries.'],
  'url-063':['permit / special-events calendar','Inspect Trumba embed and event meaning; permit activity is not automatically a public event.'],
  'url-065':['separate convention portal','Separate host/interface from tourism listings; inspect search/form filters and pagination.'],
  'url-066':['government page requiring validation','Confirm this route still exposes a useful calendar; HTTP 200 alone does not establish event content.'],
  'url-072':['SharePoint calendar candidate','Inspect rendered calendar and any supported public feed; validate instance expansion.'],
  'url-075':['annual overview','Use as secondary discovery; reconcile with the main New Orleans calendar.'],
  'url-081':['embedded calendar','HTML suggests Simpleview but browser received 403; inspect embed-source and supported public HTTP feed.'],
  'url-083':['category-specific discovery','Research-industry tag, not a complete trade-show directory; keep scope explicit.'],
  'url-084':['historical filtered view','January 2026 filters are already historical; replace with deliberate current/future scope before scheduling.'],
  'url-085':['supplemental endpoint candidate','An aggregate path returned HTML successfully; validate pagination and dates instead of assuming a documented API.'],
  'url-088':['venue reference','Use for venue/source discovery; verify whether it contains independently maintainable dated events.'],
  'url-089':['hotel / venue guide','Secondary reference; prioritize the venue calendar and verify freshness.'],
  'url-091':['press releases','Discovery lead for announcements, not a structured schedule.'],
  'url-092':['hotel / venue guide','Secondary venue reference; not a primary calendar without further inspection.'],
  'url-093':['secondary municipal calendar','Inspect Riverwalk event dates and overlap with other Chicago municipal sources.'],
  'url-094':['homepage','Discover links only; do not schedule alongside the Orlando Events collection.'],
  'url-095':['separate publisher candidate','Different domain from visitorlando.com; establish publisher identity, provenance, and overlap.'],
  'url-096':['university calendar candidate','Inspect structured calendar/feed, public-attendance scope, and pagination.'],
  'url-097':['embed-source candidate','Inspect scripts/network or published feed; do not assume the source page itself enumerates events.'],
};
const isCity=group=>!['General event discovery','Festival and fair directories','Conventions and trade shows'].includes(group);
const rows=seeds.map(seed=>{
  const http=byId.get(seed.id),browser=browserById.get(seed.id);
  let family=(http?.platforms??[]).find(p=>!['eventbrite-reference','wordpress','nextjs'].includes(p))??(http?.platforms??[]).find(p=>p!=='eventbrite-reference')??'custom / inspect';
  if(seed.sourceHost==='conventioncalendar.com')family='ConventionCalendar shared publisher';
  if(seed.sourceHost==='eventbrite.com')family='Eventbrite city discovery';
  if(['url-037','url-038'].includes(seed.id))family='LA convention-center HTML';
  const annual=/annual|year-at-a-glance|street-fairs-nyc|\/2026-New-York/.test(seed.url)||['url-006','url-031'].includes(seed.id);
  let [role,nextStep]=descriptions[seed.id]??(annual?['annual / editorial guide','Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition.']:['collection candidate','Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe.']);
  if((http?.statusCode>=400||http?.likelyChallenge)&&!browser?.outcome?.includes('succeeded'))nextStep='Access investigation first. '+nextStep;
  const cadenceHours=role.includes('guide')||role.includes('overview')||role.includes('reference')||role.includes('information')||role==='homepage'||role.includes('press')?168:family.includes('wordpress-the-events-calendar')||family.includes('Eventbrite')?6:family==='drupal'||family==='opencities'?12:24;
  return {...seed,groupKind:isCity(seed.group)?'city-market':'category',cityMarketHint:isCity(seed.group)?seed.group:null,
    categoryHints:isCity(seed.group)?[]:[seed.group],familyHint:family,role,proposedCadenceHours:cadenceHours,
    httpInspection:http?{statusCode:http.statusCode,title:http.title,finalUrl:http.finalUrl,likelyChallenge:http.likelyChallenge,error:http.error}:null,
    browserInspection:browser?{statusCode:browser.statusCode,outcome:browser.outcome,artifactDir:browser.artifactDir,error:browser.error}:null,
    nextStep,normalCollectionEnabled:false};
});
await writeFile('_working/source_assessment.json',JSON.stringify({checkedAt:recon.finishedAt,scope:'HTTP reconnaissance of all supplied URLs; browser and extraction samples explicitly identified',rows},null,2)+'\n');
const primary=rows.filter(r=>r.origin==='primary-list');
let md='# Source assessment\n\nObserved October 16, 2026 in America/Chicago; raw capture timestamps use UTC. This is onboarding triage, not a compatibility guarantee. Platform names are HTML hints, not verified API contracts. All recurring collection remains disabled.\n\n';
md+=`${primary.length} primary URLs in ${new Set(primary.map(r=>r.group)).size} groups, covering ${new Set(primary.map(r=>r.sourceHost)).size} normalized hostnames; ${rows.length-primary.length} additional citation-only leads. ${primary.filter(r=>r.httpInspection?.statusCode===200&&!r.httpInspection?.likelyChallenge).length} primary URLs returned unflagged HTTP 200 responses. That is transport evidence, not successful event extraction.\n\n`;
for(const origin of ['primary-list','citation-only-lead']){
 md+=`## ${origin==='primary-list'?'Primary URL list':'Additional citation-only leads'}\n\n`;
 for(const group of [...new Set(rows.filter(r=>r.origin===origin).map(r=>r.group))]){
  md+=`### ${group}\n\n| ID and URL | Observation / family hint | Role and next action | Proposed interval |\n| --- | --- | --- | --- |\n`;
  for(const r of rows.filter(r=>r.origin===origin&&r.group===group)){
   const access=r.httpInspection?.statusCode??r.httpInspection?.error?.code??'error';
   const browser=r.browserInspection?`; browser ${r.browserInspection.statusCode??'error'}`:'';
   md+=`| ${r.id} [${r.url}](${r.url.replaceAll('|','%7C')}) | HTTP ${access}${r.httpInspection?.likelyChallenge?' challenge':''}${browser}; ${r.familyHint} | **${r.role}**: ${r.nextStep} | ${r.proposedCadenceHours}h, disabled |\n`;
  }
  md+='\n';
 }
}
md+='## Onboarding batches\n\n1. Finish completeness and detail-page checks for the three tested sources.\n2. Validate the shared TEC adapter on networkinvegas.com and choosechicago.com; coalesce the two network.vegas views.\n3. Develop and test one Simpleview adapter against one tourism site, then validate each other tenant independently.\n4. Add a ConventionCalendar adapter for the main directory and venue pages.\n5. Add public-feed/HTML adapters for Drupal, OpenCities, and the two Trumba embeds, allowing site-specific differences.\n6. Investigate aggregators, access-blocked sites, and custom calendars individually; no challenge bypass.\n7. Use annual guides, press releases, hotel pages, homepages, and year-specific articles as discovery leads; only enable dated, validated collections.\n\nNever activate every URL just because a shared platform hint matches. Each source needs verified pagination, identities, scope, and access.\n';
await writeFile('_working/source_assessment.md',md);
console.log(JSON.stringify({rows:rows.length,primary:primary.length,report:'_working/source_assessment.md'}));
