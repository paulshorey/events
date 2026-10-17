import { readFile, writeFile, readdir } from 'node:fs/promises';
const sourceIds=['la-convention-center','boston-gov','network-vegas'];
const results=await Promise.all(sourceIds.map(id=>readFile(`.artifacts/latest/${id}.json`,'utf8').then(JSON.parse)));
if(results.some(r=>r.outcome!=='sample_passed'))throw new Error('Only accepted samples may be exported');
const events=results.flatMap(run=>run.records.map(record=>({
  ...record,sampleKey:`${record.sourceId}/${record.sourceRecordId}`,runId:run.runId,collectedAt:run.finishedAt,
  sourceCompletenessVerified:false,
})));
if(new Set(events.map(e=>e.sampleKey)).size!==events.length)throw new Error('Duplicate source occurrence keys in sample');
const indexBy=fn=>{
  const index={};for(const event of events)for(const key of fn(event)) (index[key]??=[]).push(event.sampleKey);
  return index;
};
const generatedAt=new Date().toISOString();
await writeFile('_working/sample_events.json',JSON.stringify({
  schemaVersion:1,generatedAt,kind:'bounded live samples; not a canonical database',count:events.length,
  indexingNotes:'Market cities and source-level category hints are discovery metadata; physical localities and upstream categories remain separately attributed.',
  indexes:{cityMarkets:indexBy(e=>[e.marketCity]),sourceLocalities:indexBy(e=>e.location.locality?[e.location.locality]:[]),
    categoryLabels:indexBy(e=>e.categoryTags.map(c=>c.label))},events,
},null,2)+'\n');
const attempts=[];
for(const name of await readdir('.artifacts/runs')){
  try{attempts.push(JSON.parse(await readFile(`.artifacts/runs/${name}/result.json`)));}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const inspections=[];
for(const name of await readdir('.artifacts/browser-probes')){
  const path=`.artifacts/browser-probes/${name}/inspection.json`;
  try{const r=JSON.parse(await readFile(path));inspections.push({id:r.id,url:r.url,statusCode:r.statusCode,outcome:r.outcome,error:r.error,path});}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
await writeFile('_working/prototype_results.json',JSON.stringify({
  recordedAt:generatedAt,localObservationDate:'2026-10-16',observationTimeZone:'America/Chicago',
  checkedEnvironment:{node:'26.9.0',playwright:'1.64.1',browser:'headless Chromium on this Mac'},
  offlineValidation:{command:'npm test',observedPassedTests:13,observedFailedTests:0,automaticRevalidationOnExport:false},
  liveSamples:results.map(r=>({sourceId:r.sourceId,runId:r.runId,finishedAt:r.finishedAt,outcome:r.outcome,
    recordCount:r.records.length,enumeration:r.enumeration,warnings:r.records.filter(e=>e.warnings.length).map(e=>({id:e.sourceRecordId,warnings:e.warnings})),
    resultPath:`.artifacts/runs/${r.runId}/result.json`})),
  failedAttempts:attempts.filter(r=>r.error).map(r=>({sourceId:r.sourceId,runId:r.runId,error:r.error,nextAction:r.nextAction,resultPath:`.artifacts/runs/${r.runId}/result.json`})),
  browserInspections:inspections,
  databaseConnected:false,recurringAutomationCreated:false,productionDispatchImplemented:false,
},null,2)+'\n');
console.log(JSON.stringify({exportedEvents:events.length,sourceSamples:results.length,allScopesIncomplete:true}));
