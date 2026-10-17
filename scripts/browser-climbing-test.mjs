import {drawHold} from './helpers/hold-regions.mjs';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[],remoteRequests=[],runs=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remoteRequests.push(r.url());});
await page.addInitScript(()=>{
 const Original=window.Worker;
 window.Worker=class extends Original{
  constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='result')window.__observations.push({time:performance.now(),inference_ms:data.inference_ms,visible:data.landmarks.filter(p=>p.visibility>=.5).length});});}
 };
 window.__observations=[];
});
const quantile=(list,q)=>{const s=[...list].sort((a,b)=>a-b);return Number(s[Math.floor((s.length-1)*q)].toFixed(2));};
async function snapshot(name){const pending=page.waitForEvent('download');await page.click('#json');const d=await pending;await d.saveAs(`artifacts/${name}.json`);return JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));}
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.check('#fixed-camera');
 if(process.argv.includes('--ui-only'))runs.push(...JSON.parse(await readFile('artifacts/climbing-benchmark.json','utf8')).runs);
 else for(const model of ['lite','full']){
  await page.selectOption('#pose-model',model);
  for(const index of [1,2]){
   await page.evaluate(()=>window.__observations=[]);
   await page.selectOption('#sample',{index});
   await page.waitForFunction(()=>window.__observations.length>=110,null,{timeout:90000});
   await page.click('#play');
   await page.waitForFunction(()=>document.querySelector('#pose-state').textContent==='已暂停');
   const samples=await page.evaluate(()=>window.__observations.slice(20,110));
   const data=await snapshot(`climbing-${model}-${index}`);
   assert.equal(data.model,model);assert.equal(data.landmarks.length,33);assert.ok(data.fixed_camera);
   for(const [key,ids] of [['leftArmExtension',[11,13,15]],['rightArmExtension',[12,14,16]]]){const valid=ids.every(i=>{const p=data.landmarks[i];return p&&p.visibility>=.5&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;});if(valid)assert.ok(Number.isFinite(data.climbing[key]));else assert.equal(data.climbing[key],null);}
   const run={model,video:index,frames:samples.length,inference_ms_p50:quantile(samples.map(s=>s.inference_ms),.5),inference_ms_p95:quantile(samples.map(s=>s.inference_ms),.95),processed_fps:Number(((samples.length-1)*1000/(samples.at(-1).time-samples[0].time)).toFixed(2)),visible_points_median:quantile(samples.map(s=>s.visible),.5)};
   runs.push(run);console.log(JSON.stringify(run));
   await page.screenshot({path:`artifacts/climbing-${model}-${index}.png`});
   await page.click('#stop');
  }
 }
 await writeFile('artifacts/climbing-benchmark.json',JSON.stringify({runs,ui_verified:false},null,2));
 // Re-enter a sample for fixed-camera gating, drawing and exports.
 await page.selectOption('#sample',{index:1});
 await page.waitForFunction(()=>document.querySelector('#body-center').textContent!=='—');
 await page.click('#mark-holds');
 await page.locator('#canvas').scrollIntoViewIfNeeded();
 let rect=await page.locator('#canvas').boundingBox();
 await drawHold(page,.3,.4);
 assert.equal(await page.locator('#hold-count').textContent(),'1 个标记');
 await page.check('#mirror');
 await page.locator('#canvas').scrollIntoViewIfNeeded();rect=await page.locator('#canvas').boundingBox();
 await drawHold(page,.3,.4);
 assert.equal(await page.locator('#hold-count').textContent(),'2 个标记');
 await page.click('#play');
 await page.waitForFunction(()=>document.querySelector('#center-speed').textContent!=='—');
 await page.click('#play');
 const marked=await snapshot('climbing-marked');assert.ok(Number.isFinite(marked.motion.centerSpeed));
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/climbing-final-desktop.png'});
 await page.locator('#body-center').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/climbing-final-metrics.png'});
 assert.ok(Math.abs(marked.holds[0].x-.3)<.01);assert.ok(Math.abs(marked.holds[1].x-.7)<.01);
 const csvEvent=page.waitForEvent('download');await page.click('#csv');await(await csvEvent).saveAs('artifacts/climbing-metrics.csv');
 const csv=await readFile('artifacts/climbing-metrics.csv','utf8');assert.match(csv,/center_proxy_x/);assert.match(csv,/left_hand_near_hold/);assert.ok(!csv.includes('NaN'));
 await page.click('#clear-holds');assert.equal(await page.locator('#hold-count').textContent(),'0 个标记');
 await page.uncheck('#fixed-camera');assert.equal(await page.locator('#center-speed').textContent(),'—');
 assert.ok(!(await page.locator('#mark-holds').isDisabled()));
 await page.click('#play');await page.waitForFunction(()=>document.querySelector('#frame-count').textContent.includes('已处理'));
 await page.waitForTimeout(500);await page.click('#play');
 const disabled=await snapshot('climbing-unfixed');assert.equal(disabled.motion.centerSpeed,null);assert.equal(disabled.fixed_camera,false);
 await page.selectOption('#pose-model','lite');assert.equal(await page.locator('#body-center').textContent(),'—');assert.ok(await page.locator('#json').isDisabled());
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'artifacts/climbing-mobile.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(remoteRequests,[]);
 const report={ui_verified:true,machine:'Apple M2 / 16 GiB / 8 CPU cores',runtime:'Chrome headless, Worker CPU WASM, source long edge capped at 960 px, target 30 FPS',scope:'Throughput and functional verification only; no annotated pose ground truth; physical webcam not tested',runs,errors,remoteRequests};
 await writeFile('artifacts/climbing-benchmark.json',JSON.stringify(report,null,2));
 console.log('Climbing metrics, model switching, marker mirroring, CSV and local-only checks passed.');
}finally{await browser.close();}
