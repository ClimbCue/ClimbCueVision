import {drawHold} from './helpers/hold-regions.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[],packets=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 // Deliberately mock cloud execution. No keys or paid provider calls in UI regression tests.
 await page.route('**/api/coach/config',r=>r.fulfill({json:{configured:true,model:'Qwen3.6-35B-A3B'}}));
 await page.route('**/api/coach/test',r=>r.fulfill({json:{passed:true,checks:[{kind:'text',passed:true,answer:'OK',elapsed_ms:12},{kind:'image',passed:true,answer:'蓝色',elapsed_ms:15}]}}));
 await page.route('**/api/coach/next',async route=>{
  const body=route.request().postDataJSON();packets.push(body);
  assert.equal(body.mode,'llm');assert.equal(body.frame_images.snapshot_id,body.snapshot_id);
  assert.match(body.frame_images.raw,/^data:image\/jpeg;base64,/);
  assert.notEqual(body.frame_images.raw,body.frame_images.annotated);
  assert.equal(body.custom_prompt,'优先脚法与髋部位置，每次只提醒一个动作。');
  // Exercise real server validation and card presentation with a deterministic local plan.
  const response=await route.fetch({postData:JSON.stringify({...body,mode:'preview'})});
  assert.equal(response.status(),200);
  const result=await response.json();result.mode='llm';result.model='Qwen3.6-35B-A3B (UI fixture)';
  result.model_executed=true;result.input_summary.images=2;
  await route.fulfill({json:result});
 });
 await page.goto(base+'/pose');
 await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.check('#fixed-camera');await page.selectOption('#sample',{index:1});
 await page.waitForFunction(()=>!document.querySelector('#coach-run').disabled&&document.querySelector('#hip').textContent!=='—',null,{timeout:60000});
 await page.click('#mark-holds');await page.locator('#canvas').scrollIntoViewIfNeeded();
 await drawHold(page,.3,.4);
 await page.locator('summary').filter({hasText:'我的指导提示词'}).click();
 await page.fill('#coach-custom-prompt','优先脚法与髋部位置，每次只提醒一个动作。');
 await page.click('#coach-test');await page.waitForFunction(()=>document.querySelector('#coach-mode').value==='llm');
 await page.click('#coach-run');await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 assert.equal(await page.locator('#coach-cue').textContent(),await page.locator('#coach-detail-instruction').textContent());
 assert.match(await page.locator('#coach-meta').textContent(),/2 张图片/);
 assert.equal(packets.length,1);assert.equal(packets[0].holds.length,1);
 assert.ok(Math.abs(packets[0].holds[0].x-.3)<.02);
 await page.check('#mirror');await page.click('#coach-run');
 await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 assert.equal(packets.length,2);
 assert.equal(packets[0].frame_images.raw,packets[1].frame_images.raw,'Preview mirror must not mirror cloud inputs');
 assert.equal(packets[0].frame_images.annotated,packets[1].frame_images.annotated);
 assert.deepEqual(packets[0].holds,packets[1].holds);
 await writeFile('artifacts/coach-vision-input.json',JSON.stringify(packets[0]));
 await page.locator('.coach-card').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/coach-vision-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.coach-card').scrollIntoViewIfNeeded();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'artifacts/coach-vision-mobile.png'});
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/coach-vision-ui-report.json',JSON.stringify({passed:true,real_llm_called:false,errors,
  checks:['real video pose frame','two JPEG images','same snapshot ID','unmirrored source coordinates','custom prompt','same short and detailed action','connection button','mobile layout'],
  snapshot_id:packets[0].snapshot_id,images:2},null,2));
 console.log('Vision coaching UI passed; cloud replies mocked, no real LLM called.');
}finally{await browser.close();}
