import { browserPage, navigate } from './runtime.mjs';
import { parseLaCalendar } from './parsers.mjs';

export const source={id:'la-convention-center',timeZone:'America/Los_Angeles',intervalHours:24,
  urls:['https://www.laconventioncenter.com/events','https://www.laconventioncenter.com/events/all']};
export async function run(ctx) {
  return browserPage(ctx,async page=>{
    const input=await navigate(page,source.urls[1],ctx,'.eventItem h3.title a','calendar');
    const parsed=parseLaCalendar(input.html,input.url);
    return {records:parsed.records.filter(r=>(r.endDate??r.startDate)>=ctx.asOf).slice(0,ctx.limit)
      .map(r=>({...r,evidence:{...r.evidence,capture:input.ref.path}})),
      enumeration:{complete:false,scope:'one rendered /events/all page; bounded record sample; no detail enrichment',
        observedRecords:parsed.observedCount,pagesVisited:1,stopReason:'prototype_sample',detailPagesVisited:0}};
  });
}
