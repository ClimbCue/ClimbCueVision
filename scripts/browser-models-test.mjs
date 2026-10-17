import {chromium} from 'playwright';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[],remote=[],runs=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remote.push(r.url());});
await page.addInitScript(()=>{
 window.__samples=[];const Original=window.Worker;
 window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='result')window.__samples.push({at:performance.now(),inference_ms:data.inference_ms});});}};
});
async function snapshot(name){const pending=page.waitForEvent('download');await page.click('#json');await(await pending).saveAs(`artifacts/${name}.json`);return JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));}
try{
 await page.goto(base+'/pose');await page.locator('#sam-tools').evaluate(el=>el.open=true);await page.waitForFunction(()=>document.querySelector('#pose-model').options.length===6);
 await page.check('#fixed-camera');
 for(const model of ['lite','full','heavy','rtmpose-s','rtmpose-m','yolo26n-pose']){
  for(const video of [1,2]){
   await page.selectOption('#pose-model',model);
   await page.evaluate(()=>window.__samples=[]);
   await page.selectOption('#sample',{index:video});
   await page.waitForFunction(()=>window.__samples.length>=35,null,{timeout:150000});
   await page.click('#play');await page.waitForTimeout(500);
   const samples=await page.evaluate(()=>window.__samples.slice(5,35));
   const data=await snapshot(`model-ui-${model}-${video}`);
   assert.equal(data.model,model);assert.equal(data.landmarks.length,33);
   assert.equal(data.keypoint_count,model.startsWith('rtmpose')?26:model.startsWith('yolo')?17:33);
   assert.equal(data.native_landmarks.length,data.keypoint_count);
   if(model.startsWith('yolo')){assert.equal(data.landmarks[31],null);assert.equal(data.climbing.leftAnkle,null);}
   const sorted=samples.map(s=>s.inference_ms).sort((a,b)=>a-b);
   const run={model,video,frames:samples.length,p50_ms:sorted[14],p95_ms:sorted[28],fps:29000/(samples[29].at-samples[0].at)};runs.push(run);console.log(JSON.stringify(run));
   await page.screenshot({path:`artifacts/model-ui-${model}-${video}.png`});
   if(video===2)await page.click('#stop');
  }
 }
 await page.selectOption('#pose-model','lite');await page.selectOption('#sample',{index:1});
 await page.waitForFunction(()=>document.querySelector('#json').disabled===false);await page.click('#play');await page.waitForTimeout(200);
 for(const model of ['fastsam-s','mobilesam','sam2.1-tiny']){
  await page.click('#segment-clear');await page.selectOption('#segment-model',model);await page.click('#segment-click');
  const rect=await page.locator('#canvas').boundingBox();await page.mouse.click(rect.x+rect.width*.3,rect.y+rect.height*.4);
  await page.waitForFunction(()=>/个候选|分割失败/.test(document.querySelector('#segment-status').textContent),null,{timeout:120000});
  const text=await page.locator('#segment-status').textContent();assert.ok(!text.includes('失败'),text);
  assert.ok(!(await page.locator('#segment-accept').isDisabled()),text);
  const data=await snapshot(`segment-ui-${model}`);assert.equal(data.segmentation.model,model);assert.ok(data.segmentation.polygons.length>0);
  await page.screenshot({path:`artifacts/segment-ui-${model}.png`});
  await page.click('#segment-accept');assert.match(await page.locator('#hold-count').textContent(),/[1-9]/);
  await page.click('#clear-holds');
 }
 await page.selectOption('#segment-model','fastsam-s');await page.click('#segment-all');
 await page.waitForFunction(()=>/个候选|分割失败/.test(document.querySelector('#segment-status').textContent),null,{timeout:120000});
 assert.ok(await page.locator('#segment-accept').isDisabled());await page.locator('#segment-candidates input').first().check();assert.ok(!(await page.locator('#segment-accept').isDisabled()));await page.click('#segment-clear');assert.ok(await page.locator('#segment-accept').isDisabled());
 await page.uncheck('#fixed-camera');assert.ok(!(await page.locator('#segment-click').isDisabled()));assert.ok(await page.locator('#holds-play').isDisabled());
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'artifacts/models-mobile.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 await writeFile('artifacts/browser-model-benchmark.json',JSON.stringify({runs,errors,remote,ui_verified:true,scope:'Chrome browser playback and drawing; 5 warmup + 30 measured frames per model/clip; target 30FPS; no accuracy ground truth'},null,2));
 console.log('All model switching, native keypoints, missing feet, segmentation prompts, exports and local-only checks passed.');
}finally{await browser.close();}
