import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/models/')&&r.url().includes('/infer'))requests.push(r.url());});
async function clickPoint(x,y){await page.locator('#canvas').scrollIntoViewIfNeeded();const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+x*b.width,b.y+y*b.height);}
async function snapshot(name){const dl=page.waitForEvent('download');await page.click('#json');await(await dl).saveAs(`artifacts/${name}.json`);return JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));}
async function completeBatch(){await page.click('#segment-run');await page.waitForFunction(()=>document.querySelector('#segment-status').textContent.startsWith('批量完成'),null,{timeout:180000});}
try{
 await page.goto(base+'/pose');await page.locator('#sam-tools').evaluate(el=>el.open=true);await page.waitForFunction(()=>document.querySelector('#segment-model').options.length===4);await page.check('#fixed-camera');await page.selectOption('#sample',{index:2});await page.waitForFunction(()=>document.querySelector('#video').currentTime>=3&&!document.querySelector('#json').disabled);
 await page.click('#segment-multi');await page.waitForTimeout(250);
 await clickPoint(.57,.35);await clickPoint(.12,.58);await clickPoint(.82,.61);
 assert.equal(await page.locator('#segment-run').textContent(),'分割所选 3 点');
 await page.click('#segment-undo');assert.equal(await page.locator('#segment-run').textContent(),'分割所选 2 点');
 await page.locator('#canvas').screenshot({path:'artifacts/multi-holds-prompts.png'});
 await completeBatch();console.log(await page.locator('#segment-status').textContent());
 const first=await snapshot('multi-holds-candidates');assert.equal(first.segmentation.requests.length,2);assert.equal(await page.locator('#segment-candidates input:checked').count(),2);
 // A later batch adds to the same frozen frame and retains the earlier selections.
 await page.click('#segment-multi');await clickPoint(.82,.61);await completeBatch();
 assert.ok(await page.locator('#segment-candidates input:checked').count()>=3);
 await page.click('#segment-select-none');assert.ok(await page.locator('#segment-accept').isDisabled());await page.click('#segment-select-all');
 const selected=await page.locator('#segment-candidates input:checked').count();assert.ok(selected>=3);
 await page.click('#holds-play');await page.waitForFunction(()=>!document.querySelector('#video').paused&&document.querySelector('#hold-monitor').textContent.includes('实时监测'));
 const before=await snapshot('multi-holds-playing-before'),nRequests=requests.length,duration=await page.locator('#video').evaluate(v=>v.duration);
 await page.waitForTimeout(1600);const after=await snapshot('multi-holds-playing-after');
 assert.equal(before.holds.length,selected);assert.deepEqual(after.holds,before.holds);assert.ok(after.frame>before.frame+10);assert.ok((after.video_seconds-before.video_seconds+duration)%duration>.5);assert.equal(requests.length,nRequests,'No segmentation requests while pose tracking');assert.ok(after.landmarks.length>0);assert.notDeepEqual(after.landmarks,before.landmarks);
 await page.locator('#canvas').screenshot({path:'artifacts/multi-holds-live.png'});
 // Add manual points to the same holds, undo the last one, then keep tracking.
 await page.click('#mark-holds');await clickPoint(.2,.1);await clickPoint(.4,.1);await page.click('#undo-hold');const manual=await snapshot('multi-holds-manual');assert.equal(manual.holds.length,selected+1);await page.click('#holds-play');await page.waitForFunction(()=>!document.querySelector('#video').paused);
 // Cancel a batch during its first request. No second prompt may run or revive a stale mask.
 let release,intercepted=0;
 await page.route('**/api/models/*/infer*',async route=>{intercepted++;await new Promise(r=>release=r);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({model:'mobilesam',runtime:'test',inference_ms:1,polygons:[[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]]})});});
 await page.click('#segment-multi');await clickPoint(.15,.15);await clickPoint(.6,.7);await page.click('#segment-run');for(let i=0;i<50&&!release;i++)await page.waitForTimeout(100);assert.ok(release);await page.click('#play');release();await page.waitForTimeout(500);assert.equal(intercepted,1);assert.equal(await page.locator('#segment-candidates input').count(),0);await page.unroute('**/api/models/*/infer*');
 assert.equal((await snapshot('multi-holds-after-cancel')).holds.length,selected+1);
 await page.setViewportSize({width:390,height:844});await page.locator('#segmentation').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/multi-holds-mobile.png'});
 await page.selectOption('#sample',{index:1});await page.waitForFunction(()=>!document.querySelector('#json').disabled);assert.equal((await snapshot('multi-holds-new-input')).holds.length,0);
 assert.deepEqual(errors,[]);await writeFile('artifacts/multi-holds-report.json',JSON.stringify({passed:true,confirmed_sam_holds:selected,live_frames:after.frame-before.frame,seconds:(after.video_seconds-before.video_seconds+duration)%duration,segmentation_requests_during_play:requests.length-nRequests-intercepted,checks:['real MobileSAM multiple rock prompts','prompt undo','append second batch','bulk candidate selection','confirm and play','unchanged hold geometry with updating landmarks','manual append and undo','cancel in-flight batch','mobile layout','new input clears holds'],errors},null,2));console.log('Multi-hold marking and real-time pose tracking passed.');
}finally{await browser.close();}
