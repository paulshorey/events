import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { assertValidRecords, MiningError, nextAction } from '../examples/parsers.mjs';

const args=process.argv.slice(2);
const option=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const adapters={
  'la-convention-center':()=>import('../examples/la-convention-center.mjs'),
  'boston-gov':()=>import('../examples/boston-gov.mjs'),
  'network-vegas':()=>import('../examples/network-vegas-api.mjs'),
};
if(args.includes('--list')){console.log(Object.keys(adapters).join('\n'));process.exit(0);}
const sourceId=option('--source');
if(!adapters[sourceId]) throw new Error(`Choose --source ${Object.keys(adapters).join('|')}`);
const {source,run}=await adapters[sourceId]();
const limit=Number(option('--limit','10')),maxPages=Number(option('--max-pages','2'));
if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(maxPages)||maxPages<1||maxPages>10)
  throw new Error('Prototype bounds: --limit 1..100, --max-pages 1..10');
const asOf=option('--as-of',new Intl.DateTimeFormat('en-CA',{timeZone:source.timeZone}).format(new Date()));
if(!/^\d{4}-\d\d-\d\d$/.test(asOf)||!Number.isFinite(Date.parse(asOf))) throw new Error('Invalid --as-of YYYY-MM-DD');
const runId=`${new Date().toISOString().replace(/[:.]/g,'-')}-${sourceId}-${randomUUID().slice(0,8)}`;
const outputDir=resolve('.artifacts/runs',runId),ctx={outputDir,limit,maxPages,asOf,timeZone:source.timeZone,captures:[]};
await mkdir(outputDir,{recursive:true});
const result={runId,sourceId,adapterVersion:'prototype-v1',startedAt:new Date().toISOString(),asOf,limit,maxPages,
  mode:'bounded-live-prototype',outcome:'failed',records:[],enumeration:{complete:false}};
try{
  Object.assign(result,await run(ctx));
  if(!result.records.length) throw new MiningError('no_results_unverified','Zero records; explicit empty-state verification is not implemented');
  assertValidRecords(result.records);
  result.outcome='sample_passed';
}catch(error){
  result.outcome='failed';
  result.error={code:error.code??(/Timeout|fetch failed|ECONN|net::ERR/.test(error.message)?'transport_error':'unexpected_error'),message:error.message.slice(0,1500)};
}
result.finishedAt=new Date().toISOString();result.captures=ctx.captures;result.nextAction=nextAction(result);
await writeFile(`${outputDir}/result.json`,JSON.stringify(result,null,2)+'\n');
await writeFile(`${outputDir}/events.jsonl`,result.records.map(r=>JSON.stringify(r)).join('\n')+(result.records.length?'\n':''));
// A failed refresh never replaces the last successful sample.
if(result.outcome==='sample_passed'){
  await mkdir('.artifacts/latest',{recursive:true});
  await writeFile(`.artifacts/latest/${sourceId}.json`,JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({runId,sourceId,outcome:result.outcome,records:result.records.length,enumeration:result.enumeration,
  nextAction:result.nextAction,error:result.error,resultPath:`${outputDir}/result.json`},null,2));
if(result.error) process.exitCode=1;
