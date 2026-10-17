import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[],runs=[];page.on('pageerror',e=>errors.push(e.message));
async function exportJSON(id,name){const pending=page.waitForEvent('download');await page.click(id);await(await pending).saveAs(`artifacts/${name}.json`);return JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));}
async function waitResult(){await page.waitForFunction(()=>/个候选|分割失败/.test(document.querySelector('#segment-status').textContent),null,{timeout:120000});const s=await page.locator('#segment-status').textContent();assert.ok(!s.includes('失败'),s);}
async function point(x,y){await page.click('#segment-click');const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+b.width*x,b.y+b.height*y);}
try{
 await page.goto(base+'/pose');await page.locator('#sam-tools').evaluate(el=>el.open=true);await page.waitForFunction(()=>document.querySelector('#segment-model').options.length===4);
 assert.equal(await page.inputValue('#segment-model'),'mobilesam');await page.check('#fixed-camera');
 await page.selectOption('#sample',{index:2});await page.waitForFunction(()=>document.querySelector('#video').currentTime>=3&&!document.querySelector('#json').disabled);await page.click('#play');await page.waitForTimeout(300);
 for(const model of ['fastsam-s','mobilesam','sam2.1-tiny']){
  await page.click('#segment-clear');await page.selectOption('#segment-model',model);await point(.57,.35);await waitResult();
  await page.locator('#canvas').screenshot({path:`artifacts/sam-debug-${model}.png`});console.log(model,await page.locator('#segment-status').textContent());
  const debug=await exportJSON('#json',`sam-debug-${model}`);console.log(JSON.stringify({source:debug.source,point:debug.segmentation?.point,polygons:debug.segmentation?.polygons.length}));
  assert.equal(await page.locator('#segment-candidates input:checked').count(),1);
  const candidate=await exportJSON('#segment-export',`sam-hold-${model}-candidate`);assert.equal(candidate.segmentation.model,model);assert.equal(candidate.holds.length,0);
  await page.click('#segment-accept');assert.equal(await page.locator('#hold-count').textContent(),'1 个标记');
  const result=await exportJSON('#segment-export',`sam-hold-${model}-confirmed`);assert.equal(result.holds.length,1);assert.ok(result.holds[0].polygon.length>=3);assert.ok(result.holds[0].area_fraction>0);assert.ok(result.holds[0].area_fraction<.2,'Prompt should not segment the entire wall');
  const pose=await exportJSON('#json',`sam-hold-${model}-pose`);assert.deepEqual(pose.holds,result.holds);
  await page.locator('#segmentation').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/sam-hold-${model}.png`});
  await page.locator('#canvas').screenshot({path:`artifacts/sam-hold-${model}-overlay.png`});
  runs.push({model,inference_ms:candidate.segmentation.inference_ms,runtime:candidate.segmentation.runtime,area_fraction:result.holds[0].area_fraction,vertices:result.holds[0].polygon.length});
  await page.click('#clear-holds');assert.deepEqual((await exportJSON('#json','sam-cleared')).holds,[]);
 }
 await page.selectOption('#segment-model','fastsam-s');await page.click('#segment-all');await waitResult();
 assert.ok(await page.locator('#segment-candidates input').count()>1);assert.ok(await page.locator('#segment-accept').isDisabled());
 await page.locator('#segment-candidates input').first().check();await page.click('#segment-accept');assert.equal(await page.locator('#hold-count').textContent(),'1 个标记');assert.ok(await page.locator('#segment-candidates input').count()>0);
 await page.click('#clear-holds');await page.click('#segment-clear');
 // A completed response for a resumed frame must be discarded.
 let delayed;
 await page.route('**/api/models/*/infer*',async route=>{const response=await route.fetch();await new Promise(r=>delayed=r);await route.fulfill({response});});
 await point(.57,.35);await page.waitForFunction(()=>document.querySelector('#segment-status').textContent.includes('正在本机'));
 await page.click('#play');for(let n=0;n<100&&!delayed;n++)await page.waitForTimeout(100);assert.ok(delayed);delayed();await page.waitForTimeout(600);
 assert.equal(await page.locator('#segment-candidates input').count(),0);assert.ok(await page.locator('#segment-accept').isDisabled());await page.unroute('**/api/models/*/infer*');
 await page.uncheck('#fixed-camera');assert.ok(!(await page.locator('#segment-click').isDisabled()));assert.ok(await page.locator('#holds-play').isDisabled());
 await page.setViewportSize({width:390,height:844});await page.locator('#segmentation').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/sam-mobile.png'});
 assert.deepEqual(errors,[]);await writeFile('artifacts/sam-ui-report.json',JSON.stringify({runs,errors,passed:true,scope:'Real local models, large red/green rock hold in clip 2; disconnected regions kept separate; interaction and geometry checks, no ground truth accuracy benchmark'},null,2));console.log(JSON.stringify(runs,null,2));console.log('SAM selection, confirmation, export, outline fusion, stale-response and mobile checks passed.');
}finally{await browser.close();}
