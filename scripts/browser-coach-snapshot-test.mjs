// Explicit --live invokes JoyMaas once through the real app; otherwise cloud is mocked.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const live=process.argv.includes('--live'),base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];let input,result;
page.on('pageerror',e=>errors.push(e.message));
async function clickPoint(x,y){
 await page.locator('#canvas').scrollIntoViewIfNeeded();const b=await page.locator('#canvas').boundingBox();
 await page.mouse.click(b.x+x*b.width,b.y+y*b.height);
}
try{
 if(!live){
  await page.route('**/api/coach/config',r=>r.fulfill({json:{configured:true,model:'Qwen3.6-35B-A3B'}}));
  await page.route('**/api/coach/next',async r=>{
   const b=r.request().postDataJSON();const response=await r.fetch({postData:JSON.stringify({...b,mode:'preview'})});
   const data=await response.json();if(b.mode==='llm'){data.model='Qwen3.6-35B-A3B (fixture)';data.mode='llm';data.model_executed=true;data.input_summary.images=2;}
   await r.fulfill({json:data});
  });
 }
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.selectOption('#coach-mode','preview');await page.check('#fixed-camera');await page.selectOption('#sample',{index:2});
 await page.waitForFunction(()=>document.querySelector('#video').currentTime>=3&&!document.querySelector('#coach-run').disabled,null,{timeout:60000});
 // Manual analysis must capture and freeze the last rendered pose frame atomically.
 assert.equal(await page.locator('#video').evaluate(v=>v.paused),false);
 await page.click('#coach-run');await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 assert.equal(await page.locator('#video').evaluate(v=>v.paused),true);
 await page.locator('#sam-tools').evaluate(el=>el.open=true);
 await page.selectOption('#segment-model','mobilesam');await page.click('#segment-multi');
 await clickPoint(.57,.35);await clickPoint(.12,.58);await page.click('#segment-run');
 await page.waitForFunction(()=>document.querySelector('#segment-status').textContent.startsWith('批量完成'),null,{timeout:180000});
 assert.equal(await page.locator('#segment-candidates input:checked').count(),2);
 await page.click('#segment-accept');
 await page.locator('summary').filter({hasText:'我的指导提示词'}).click();
 await page.fill('#coach-custom-prompt','只分析这一瞬间的图片、人体姿态和岩点分割结果。给一条最优先的观察或确认提示，网页解释依据，不预测整条路线。');
 await page.selectOption('#coach-mode','llm');
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/coach/next')&&r.request().method()==='POST',{timeout:60000});
 await page.click('#coach-run');
 const response=await pending;input=response.request().postDataJSON();result=await response.json();
 await writeFile('artifacts/coach-snapshot-input.json',JSON.stringify(input));
 assert.equal(input.frame_images.snapshot_id,input.snapshot_id);
 assert.equal(input.holds.filter(h=>h.polygon?.length>=3&&h.source==='mobilesam').length,2);
 assert.equal(response.status(),200,JSON.stringify(result));
 assert.equal(result.input_summary.segmented_holds,2);
 await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 const short=await page.locator('#coach-cue').textContent();
 assert.equal(short,await page.locator('#coach-detail-instruction').textContent());
 assert.equal(short,result.glasses.text);assert.equal(result.snapshot_id,input.snapshot_id);
 assert.ok([...short].length<=20);assert.equal(await page.locator('#video').evaluate(v=>v.paused),true);
 assert.equal(await page.locator('#coach-result-status').textContent(),'大模型分析完成');
 assert.match(await page.locator('#coach-model-label').textContent(),/Qwen3.6/);
 assert.equal(JSON.parse(await page.locator('#coach-response').textContent()).snapshot_id,input.snapshot_id);
 await page.waitForFunction(()=>document.querySelector('#coach-snapshot').width>100&&!document.querySelector('#coach-snapshot').hidden);
 assert.match(await page.locator('#coach-snapshot-caption').textContent(),new RegExp('第 '+input.frame+' 帧'));
 assert.ok((await page.locator('#coach-execution').textContent()).length>10);
 const overlaid=await page.locator('#coach-snapshot').evaluate(c=>c.toDataURL());
 await page.uncheck('#coach-overlay');const original=await page.locator('#coach-snapshot').evaluate(c=>c.toDataURL());
 assert.notEqual(overlaid,original,'Overlay toggle must change the actual image');await page.check('#coach-overlay');
 await page.locator('#canvas').screenshot({path:'artifacts/coach-snapshot-segments.png'});
 await page.locator('#coach-results').screenshot({path:'artifacts/coach-snapshot-card.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#coach-results').screenshot({path:'artifacts/coach-snapshot-card-mobile.png'});
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/coach-snapshot-live-report.json',JSON.stringify({passed:true,real_llm_called:live,
  input_summary:{snapshot_id:input.snapshot_id,frame:input.frame,video_seconds:input.video_seconds,landmarks:input.landmarks.filter(Boolean).length,
   segmented_holds:input.holds.length,outline_vertices:input.holds.map(h=>h.polygon.length)},
  result,errors,checks:['one-click freeze','real video pose','real MobileSAM two masks','same-frame images and outline coordinates','cloud response validated','short and detailed cards agree','source frame and focus overlay','original/overlay toggle','explicit model and duration','full response inspectable','mobile layout'],
  limitations:'Single paused-frame integration test; prompted candidate masks are not coach-labeled ground truth.'},null,2));
 console.log(JSON.stringify({passed:true,real_llm_called:live,elapsed_ms:result.elapsed_ms,short,reason:result.web.reason,segmented_holds:result.input_summary.segmented_holds},null,2));
}catch(e){
 await writeFile('artifacts/coach-snapshot-live-report.json',JSON.stringify({passed:false,real_llm_called:live,error:e.message,result,errors},null,2));
 throw e;
}finally{await browser.close();}
