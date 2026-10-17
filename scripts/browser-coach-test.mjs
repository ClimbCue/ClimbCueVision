import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.check('#fixed-camera');await page.selectOption('#sample',{index:1});
 await page.waitForFunction(()=>!document.querySelector('#coach-run').disabled&&document.querySelector('#hip').textContent!=='—');
 await page.click('#mark-holds');await page.locator('#canvas').scrollIntoViewIfNeeded();
 const rect=await page.locator('#canvas').boundingBox();await page.mouse.click(rect.x+rect.width*.3,rect.y+rect.height*.4);
 await page.click('#coach-run');await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 const short=await page.locator('#coach-cue').textContent();const long=await page.locator('#coach-detail-instruction').textContent();assert.equal(short,long);assert.ok([...short].length<=20);
 assert.match(await page.locator('#coach-origin').textContent(),/未调用大模型/);
 assert.match(await page.locator('#coach-state').textContent(),/暂停帧预览/);
 const pending=page.waitForEvent('download');await page.click('#coach-export');await(await pending).saveAs('artifacts/glasses-preview.json');
 const packet=JSON.parse(await readFile('artifacts/glasses-preview.json','utf8'));assert.equal(packet.display.text,short);assert.equal(packet.model_executed,false);assert.equal(packet.hardware_connected,false);
 await page.locator('.coach-card').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/coach-desktop.png'});
 await page.click('#coach-prompt-details summary');await page.waitForFunction(()=>document.querySelector('#coach-prompt').value.includes('allowed_moves'));await page.click('#coach-prompt-details summary');
 // Resume invalidates frozen-frame guidance before a new instruction can be used.
 await page.click('#play');await page.waitForFunction(()=>document.querySelector('#coach-export').disabled);assert.match(await page.locator('#coach-state').textContent(),/失效|更新/);
 // Delayed response must not revive a discarded live command.
 await page.route('**/api/coach/next',async route=>{const response=await route.fetch();const body=await response.text();await new Promise(r=>setTimeout(r,5500));await route.fulfill({status:response.status(),contentType:'application/json',body});});
 await page.click('#coach-run');await page.waitForFunction(()=>document.querySelector('#coach-state').textContent.includes('过期'),null,{timeout:20000});
 assert.ok(await page.locator('#coach-export').isDisabled());await page.unroute('**/api/coach/next');
 await page.click('#play');await page.click('#coach-run');await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 await page.setViewportSize({width:390,height:844});await page.locator('.coach-card').scrollIntoViewIfNeeded();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/coach-mobile.png'});
 await page.selectOption('#pose-model','full');await page.waitForFunction(()=>document.querySelector('#coach-export').disabled);assert.ok(await page.locator('#coach-run').isDisabled());
 assert.deepEqual(errors,[]);await writeFile('artifacts/coach-ui-report.json',JSON.stringify({passed:true,errors,checks:['preview explicitly labeled','HUD <= 20 characters','same canonical action','glasses JSON','prompt visible','resume invalidation','late result discarded','source switch invalidation','mobile layout'],real_llm_called:false,glasses_hardware_connected:false},null,2));
 console.log('Coach dual views, prompt, export and stale-result gates passed.');
}finally{await browser.close();}
