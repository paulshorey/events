import { load } from 'cheerio';

export class MiningError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const clean = value => load(`<body>${value ?? ''}</body>`)('body').text().replace(/\s+/g, ' ').trim();
const months = Object.fromEntries(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((m,i)=>[m,i+1]));
function date(year, month, day) {
  const y=Number(year),m=Number(month),d=Number(day);
  const dt=new Date(Date.UTC(y,m-1,d));
  if (dt.getUTCFullYear()!==y || dt.getUTCMonth()!==m-1 || dt.getUTCDate()!==d) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
export function parseDateRange(raw) {
  const value=clean(raw).replace(/[–—]/g,'-');
  const m=value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?,\s*(\d{4})$/);
  if (!m) return { startDate:null,endDate:null };
  const startDate=date(m[5],months[m[1].slice(0,3).toLowerCase()],m[2]);
  const endDate=date(m[5],months[(m[3]??m[1]).slice(0,3).toLowerCase()],m[4]??m[2]);
  if (!startDate || !endDate || endDate<startDate) return { startDate:null,endDate:null };
  return { startDate,endDate };
}
export function parseTimeRange(raw) {
  const matches=[...clean(raw).matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)];
  const convert=m=>{
    const h=Number(m[1]),min=Number(m[2]??0);
    return h>=1&&h<=12&&min<60 ? `${String(h%12+(m[3].toLowerCase()==='pm'?12:0)).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`:null;
  };
  return { startTime:matches[0]?convert(matches[0]):null,endTime:matches[1]?convert(matches[1]):null };
}
function absolute(raw,base) {
  const url=new URL(raw,base);
  if (!['https:','http:'].includes(url.protocol)) throw new MiningError('contract_changed','Non-HTTP event URL');
  return url.href;
}
export function parseLaCalendar(html,base='https://www.laconventioncenter.com/events/all') {
  const $=load(html),cards=$('.eventItem');
  if (!cards.length) throw new MiningError('contract_changed','Expected .eventItem cards missing');
  const records=cards.map((_,el)=>{
    const card=$(el),a=card.find('h3.title a').first(),title=clean(a.text()),href=a.attr('href'),rawDate=clean(card.find('.date').text());
    if(!title||!href||!rawDate) throw new MiningError('contract_changed','LA event title, link or date missing');
    const dates=parseDateRange(rawDate);
    if(!dates.startDate) throw new MiningError('contract_changed',`Unsupported LA date format: ${rawDate}`);
    const url=absolute(href,base);
    return {sourceId:'la-convention-center',sourceRecordId:new URL(url).pathname,title,url,...dates,
      startLocal:null,endLocal:null,timeZone:'America/Los_Angeles',allDay:null,
      location:{venue:'Los Angeles Convention Center',locality:'Los Angeles',region:'CA',country:'US',basis:'single-venue source'},
      marketCity:'Los Angeles',sourceGroups:['Los Angeles'],categoryTags:[{label:'convention-center-events',basis:'source-level hint'}],
      raw:{date:rawDate},evidence:{selector:'.eventItem h3.title a; .eventItem .date'},warnings:[]};
  }).get();
  return {records,observedCount:cards.length};
}
export function parseBostonCalendar(html,base='https://www.boston.gov/events') {
  const $=load(html),cards=$('article.calendar-listing-wrapper');
  if(!cards.length) throw new MiningError('contract_changed','Boston calendar articles missing');
  const records=cards.map((_,el)=>{
    const card=$(el),row=card.closest('.views-row');
    const rawDate=clean(row.prevAll('h2.listing-group-title').first().text());
    const dates=parseDateRange(rawDate),rawTime=clean(card.find('.time-range').text());
    const times=parseTimeRange(rawTime),title=clean(card.find('.teaser .title').text());
    const href=card.find('a.button[href^="/node/"]').attr('href')??card.find('a.button[href]').first().attr('href');
    if(!dates.startDate||!title||!href||!card.attr('id')) throw new MiningError('contract_changed','Boston date grouping, title, node ID or detail link changed');
    const warnings=[];
    if(rawTime&&!times.startTime) warnings.push('unparsed_visible_time');
    if(times.endTime&&times.startTime&&times.endTime<times.startTime) warnings.push('end_time_requires_date_review');
    return {sourceId:'boston-gov',sourceRecordId:`${card.attr('id')}:${dates.startDate}:${times.startTime??'unknown'}`,
      title,url:absolute(href,base),...dates,startLocal:times.startTime?`${dates.startDate}T${times.startTime}`:null,
      endLocal:times.endTime&&!warnings.includes('end_time_requires_date_review')?`${dates.endDate}T${times.endTime}`:null,
      timeZone:'America/New_York',allDay:null,
      location:{venue:null,address:clean(card.find('[itemprop="streetAddress"]').text())||null,
        locality:clean(card.find('[itemprop="addressLocality"]').text())||null,
        region:clean(card.find('[itemprop="addressRegion"]').text())||null,
        country:clean(card.find('[itemprop="address"] .country').first().text())||null,basis:'source address'},
      marketCity:'Boston',sourceGroups:['Boston'],categoryTags:[{label:'municipal-events',basis:'source-level hint'}],
      raw:{date:rawDate,time:rawTime,nodeId:card.attr('id'),price:clean(card.find('.dl-i').text())||null},
      evidence:{selector:'article.calendar-listing-wrapper + preceding h2.listing-group-title'},warnings};
  }).get();
  const next=$('a[rel="next"]').attr('href')??$('.pager__item--next a').attr('href');
  return {records,observedCount:cards.length,nextUrl:next?absolute(next,base):null};
}
export function parseTribePage(data) {
  if(!data||!Array.isArray(data.events)||!Number.isInteger(data.total_pages)||!Number.isInteger(data.total))
    throw new MiningError('contract_changed','Expected TEC events[], total and total_pages');
  const records=data.events.map(event=>{
    if(!Number.isInteger(event.id)||!event.title||!event.url||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(event.start_date??''))
      throw new MiningError('contract_changed','TEC event identity, title, URL or start_date changed');
    const v=event.venue??{},warnings=[];
    if(event.all_day&&/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(clean(event.description)))
      warnings.push('source_all_day_flag_conflicts_with_timed_description');
    return {sourceId:'network-vegas',sourceRecordId:String(event.id),title:clean(event.title),url:absolute(event.url,'https://network.vegas'),
      startDate:event.start_date.slice(0,10),endDate:event.end_date?.slice(0,10)??null,
      startLocal:event.all_day?null:event.start_date.replace(' ','T'),endLocal:event.all_day?null:event.end_date?.replace(' ','T')??null,
      timeZone:event.timezone??null,allDay:event.all_day??null,
      location:{venue:clean(v.venue)||null,address:clean(v.address)||null,locality:clean(v.city)||null,
        region:clean(v.stateprovince??v.state)||null,country:clean(v.country)||null,basis:'source venue'},
      marketCity:'Las Vegas',sourceGroups:['Las Vegas'],
      categoryTags:(event.categories??[]).map(c=>({label:clean(c.name),slug:c.slug,basis:'upstream category'})),
      raw:{start_date:event.start_date,end_date:event.end_date,all_day:event.all_day,description:clean(event.description),cost:event.cost,venue:v},
      evidence:{jsonPath:`$.events[id=${event.id}]`},warnings};
  });
  return {records,total:data.total,totalPages:data.total_pages,nextUrl:data.next_rest_url??null};
}
export function assertValidRecords(records) {
  const seen=new Set();
  for(const r of records){
    const key=`${r.sourceId}:${r.sourceRecordId}`;
    if(seen.has(key)) throw new MiningError('pagination_changed',`Repeated event key: ${key}`);
    seen.add(key);
    if(!r.title||!r.url||!r.startDate) throw new MiningError('data_quality_error','Missing core event fields');
    if(r.endDate&&r.endDate<r.startDate) throw new MiningError('data_quality_error','Event ends before start');
  }
}
export function nextAction(result) {
  if(!result.error) return {action:'collect_when_due',reason:'Accepted bounded extraction; completeness tracked separately'};
  const code=result.error.code;
  if(['access_blocked','credentials_required'].includes(code)) return {action:'blocked_access',reason:'Needs access investigation, not repeated parser rewrites'};
  if(['rate_limited','transport_error'].includes(code)) return {action:'retry_after_cooldown',reason:'Transient transport or provider limit'};
  if(['contract_changed','pagination_changed','data_quality_error','no_results_unverified'].includes(code))
    return {action:'repair_adapter',reason:'Inspect evidence and fix or validate extraction before another normal run'};
  return {action:'investigate_runtime',reason:'Unexpected failure; preserve evidence'};
}
