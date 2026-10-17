import { chromium, request } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MiningError } from './parsers.mjs';

export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function classifyResponse(status,html='') {
  if(status===429) throw new MiningError('rate_limited','HTTP 429; respect provider cooldown');
  if(status===401) throw new MiningError('credentials_required','HTTP 401');
  if(status===403||/just a moment|vercel security checkpoint|verify you are human|attention required!.*cloudflare/i.test(html.slice(0,15000)))
    throw new MiningError('access_blocked',`Access challenge or denial (HTTP ${status})`);
  if(status>=500) throw new MiningError('transport_error',`Upstream HTTP ${status}`);
  if(status>=400) throw new MiningError('contract_changed',`Unexpected HTTP ${status}`);
}
export async function capture(ctx,name,content,url,kind) {
  await mkdir(ctx.outputDir,{recursive:true});
  const path=`${ctx.outputDir}/${name}`;
  await writeFile(path,content);
  const ref={path,url,kind,sha256:createHash('sha256').update(content).digest('hex')};
  ctx.captures.push(ref);return ref;
}
export async function browserPage(ctx,fn) {
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({timezoneId:ctx.timeZone});
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route('**/*',route=>['image','font','media'].includes(route.request().resourceType())?route.abort():route.continue());
  await context.tracing.start({screenshots:true,snapshots:true});
  let failed=false;
  try{return await fn(page);}catch(error){
    failed=true;
    await mkdir(ctx.outputDir,{recursive:true});
    await capture(ctx,'failure.html',await page.content().catch(()=>''),page.url(),'rendered-html');
    await page.screenshot({path:`${ctx.outputDir}/failure.png`}).catch(()=>{});
    throw error;
  }finally{
    await context.tracing.stop(failed?{path:`${ctx.outputDir}/trace.zip`}:{}).catch(()=>{});
    await context.close();await browser.close();
  }
}
export async function navigate(page,url,ctx,selector,name) {
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  let html=await page.content();
  await capture(ctx,`${name}-initial.html`,html,page.url(),'rendered-html');
  classifyResponse(response?.status()??0,html);
  try{await page.locator(selector).first().waitFor({state:'attached',timeout:12000});}
  catch{throw new MiningError('contract_changed',`Expected selector missing: ${selector}`);}
  html=await page.content();
  const ref=await capture(ctx,`${name}.html`,html,page.url(),'rendered-html');
  return {html,url:page.url(),ref};
}
export async function withApi(fn) {
  const api=await request.newContext({timeout:20000,userAgent:'EventsMiningPrototype/0.1 (bounded public source evaluation)'});
  try{return await fn(api);}finally{await api.dispose();}
}
