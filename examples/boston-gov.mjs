import { browserPage, navigate, pause } from './runtime.mjs';
import { parseBostonCalendar, MiningError } from './parsers.mjs';

export const source={id:'boston-gov',timeZone:'America/New_York',intervalHours:12,urls:['https://www.boston.gov/events']};
export async function run(ctx) {
  return browserPage(ctx,async page=>{
    let url=source.urls[0],pagesVisited=0,observedRecords=0;
    const records=[],visited=new Set();
    while(url&&pagesVisited<ctx.maxPages&&records.length<ctx.limit){
      if(visited.has(url)) throw new MiningError('pagination_changed','Boston next-page loop');
      visited.add(url);
      const input=await navigate(page,url,ctx,'article.calendar-listing-wrapper',`page-${pagesVisited+1}`);
      const parsed=parseBostonCalendar(input.html,input.url);
      pagesVisited++;observedRecords+=parsed.observedCount;
      records.push(...parsed.records.filter(r=>(r.endDate??r.startDate)>=ctx.asOf)
        .map(r=>({...r,evidence:{...r.evidence,capture:input.ref.path}})));
      url=parsed.nextUrl;
      if(url&&pagesVisited<ctx.maxPages&&records.length<ctx.limit) await pause(1000);
    }
    return {records:records.slice(0,ctx.limit),enumeration:{complete:false,scope:'bounded calendar pages; visible grouped dates and times',
      pagesVisited,observedRecords,nextUrl:url,stopReason:'prototype_sample',detailPagesVisited:0}};
  });
}
