// Diagnostic inspection only: this never declares a complete event collection.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserPage, classifyResponse } from '../examples/runtime.mjs';
import { nextAction } from '../examples/parsers.mjs';
const id=process.argv[2];
const seeds=JSON.parse(await readFile(new URL('../sources/seed-urls.json',import.meta.url)));
const seed=seeds.find(s=>s.id===id);
if(!seed) throw new Error('Usage: node scripts/browser-probe.mjs url-027');
const outputDir=resolve('.artifacts/browser-probes',`${id}-${Date.now()}`);
await mkdir(outputDir,{recursive:true});
const ctx={outputDir,captures:[],timeZone:'America/Chicago'};
const result={id,url:seed.url,checkedAt:new Date().toISOString(),kind:'browser-inspection-only',networkHints:[]};
const safeUrl=value=>{
  const u=new URL(value);
  for(const key of [...u.searchParams.keys()])if(/key|token|auth|secret|signature/i.test(key))u.searchParams.set(key,'REDACTED');
  return u.href;
};
try{await browserPage(ctx,async page=>{
  page.on('response',response=>{
    const type=response.headers()['content-type']??'';
    if(/json/i.test(type)&&!/google|facebook|doubleclick|analytics/i.test(response.url()))
      result.networkHints.push({url:safeUrl(response.url()),status:response.status()});
  });
  const response=await page.goto(seed.url,{waitUntil:'domcontentloaded',timeout:30000});
  result.statusCode=response?.status();
  classifyResponse(result.statusCode,await page.content());
  // This is a bounded network-inspection window, not an extraction readiness test.
  await page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});
  result.title=await page.title();result.finalUrl=page.url();
  result.frames=page.frames().map(f=>safeUrl(f.url())).filter(url=>url!=='about:blank');
  await writeFile(`${outputDir}/page.html`,await page.content());
  await page.screenshot({path:`${outputDir}/page.png`,fullPage:false});
  result.bodyPreview=(await page.locator('body').innerText()).slice(0,800);
  result.outcome='inspection_succeeded';
});}catch(error){result.outcome='failed';result.error={code:error.code??'transport_error',message:error.message.slice(0,600)};}
result.nextAction=result.error?nextAction(result):{action:'onboard_adapter',reason:'Browser inspection succeeded; extraction and completeness are untested'};
await writeFile(`${outputDir}/inspection.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,artifactDir:outputDir},null,2));
if(result.error)process.exitCode=1;
