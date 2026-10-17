import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { nextAction } from '../examples/parsers.mjs';

export function planSource(schedule,lastResult,now=new Date()) {
  if(!schedule.enabled) return {action:'disabled',willExecute:false};
  if(lastResult?.error){
    const next=nextAction(lastResult);
    return {...next,willExecute:false};
  }
  const nextDue=lastResult?new Date(Date.parse(lastResult.finishedAt)+schedule.intervalHours*3600000):now;
  return {action:nextDue<=now?'collect':'wait',nextDue:nextDue.toISOString(),willExecute:false};
}
export async function status() {
  const schedules=JSON.parse(await readFile(new URL('../sources/prototype-schedules.json',import.meta.url)));
  const history=[];
  let dirs=[];
  try{dirs=await readdir('.artifacts/runs',{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const dir of dirs.filter(d=>d.isDirectory())){
    try{history.push(JSON.parse(await readFile(`.artifacts/runs/${dir.name}/result.json`)));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  history.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  return schedules.map(schedule=>{
    const attempts=history.filter(h=>h.sourceId===schedule.sourceId),last=attempts[0];
    return {...schedule,lastAttempt:last?{runId:last.runId,outcome:last.outcome,finishedAt:last.finishedAt,
      error:last.error,nextAction:last.nextAction,records:last.records.length,complete:last.enumeration.complete}:null,
      previousFailures:attempts.filter(a=>a.error).map(a=>({runId:a.runId,error:a.error})),
      proposedNextActionIfEnabled:last?.error?nextAction(last):{action:'collect_when_due'},
      decision:planSource(schedule,last)};
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify({mode:'read-only scheduler preview; no dispatch or repairs',sources:await status()},null,2));
