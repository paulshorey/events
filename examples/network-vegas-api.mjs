import { withApi, capture, classifyResponse, pause } from './runtime.mjs';
import { parseTribePage, MiningError } from './parsers.mjs';

export const source={id:'network-vegas',timeZone:'America/Los_Angeles',intervalHours:6,
  urls:['https://network.vegas/calendar/','https://network.vegas/calendar/category/event-type/convention/']};
export async function run(ctx) {
  return withApi(async api=>{
    const records=[],seenPages=new Set();let pagesVisited=0,total=null,totalPages=null;
    for(let page=1;page<=ctx.maxPages&&records.length<ctx.limit;page++){
      const url=new URL('https://network.vegas/wp-json/tribe/events/v1/events');
      url.search=new URLSearchParams({per_page:'5',page:String(page),start_date:ctx.asOf});
      const response=await api.get(url.href),body=await response.text();
      const ref=await capture(ctx,`api-${page}.json`,body,url.href,'api-json');
      classifyResponse(response.status(),body);
      let data;try{data=JSON.parse(body);}catch{throw new MiningError('contract_changed','API returned non-JSON body');}
      const parsed=parseTribePage(data);
      const fingerprint=parsed.records.map(r=>r.sourceRecordId).join(',');
      if(fingerprint&&seenPages.has(fingerprint)) throw new MiningError('pagination_changed','API repeated the same event IDs');
      seenPages.add(fingerprint);pagesVisited++;total=parsed.total;totalPages=parsed.totalPages;
      records.push(...parsed.records.map(r=>({...r,evidence:{...r.evidence,capture:ref.path}})));
      if(page>=totalPages) break;
      if(page<ctx.maxPages&&records.length<ctx.limit) await pause(1000);
    }
    return {records:records.slice(0,ctx.limit),enumeration:{complete:false,scope:'events starting on/after asOf; API sample; ongoing events starting earlier need a separate strategy',
      pagesVisited,upstreamTotal:total,upstreamPages:totalPages,stopReason:'prototype_sample'}};
  });
}
