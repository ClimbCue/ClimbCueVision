import {drawHold} from './helpers/hold-regions.mjs';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function point(x,y){await page.locator('#canvas').scrollIntoViewIfNeeded();const r=await page.locator('#canvas').boundingBox();await page.mouse.click(r.x+x*r.width,r.y+y*r.height);}
async function snapshot(name){const pending=page.waitForEvent('download');await page.click('#json');await(await pending).saveAs('artifacts/'+name+'.json');return JSON.parse(await readFile('artifacts/'+name+'.json','utf8'));}
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 assert.ok(await page.locator('#mark-holds').isDisabled());
 await page.selectOption('#sample',{index:2});await page.waitForFunction(()=>!document.querySelector('#json').disabled&&document.querySelector('#video').currentTime>=3);
 assert.ok(!(await page.locator('#fixed-camera').isChecked()));assert.ok(!(await page.locator('#mark-holds').isDisabled()));
 // Manual region drawing pauses playback without requiring the fixed-camera checkbox.
 await drawHold(page,.56,.35);assert.ok(await page.locator('#video').evaluate(v=>v.paused));
 const first=await snapshot('hold-selection-first');assert.equal(first.holds.length,1);assert.equal(first.fixed_camera,false);
 await page.waitForTimeout(400);assert.equal((await snapshot('hold-selection-frozen')).frame,first.frame,'Late pose results must not replace the selected frame');
 await drawHold(page,.12,.58);assert.equal((await snapshot('hold-selection-second')).holds.length,2);
 await point(.12,.58);await page.click('#delete-hold');assert.equal((await snapshot('hold-selection-delete')).holds.length,1);
 await page.click('#undo-hold');assert.equal((await snapshot('hold-selection-undo')).holds.length,2);
 assert.ok(await page.locator('#holds-play').isDisabled());
 // Color scan also works on a still frame without fixed-camera checkbox.
 const response=page.waitForResponse(r=>r.url().includes('/api/holds/color'));await page.getByRole('button',{name:'选择红色岩点',exact:true}).click();assert.ok((await response).ok());await page.waitForFunction(()=>document.querySelector('#color-status').textContent.startsWith('找到'));
 const n=await page.locator('#segment-candidates input:checked').count();assert.ok(n>0);
 // Confirming camera condition must not throw away the work already done.
 await page.check('#fixed-camera');assert.equal(await page.locator('#segment-candidates input:checked').count(),n);assert.equal((await snapshot('hold-selection-fixed')).holds.length,2);
 await page.click('#holds-play');await page.waitForFunction(()=>!document.querySelector('#video').paused);const playing=await snapshot('hold-selection-playing');assert.equal(playing.holds.length,n+2);
 await page.waitForTimeout(500);assert.ok((await snapshot('hold-selection-moving')).frame>playing.frame);
 // Stop retains an editable image; no invisible disabled gate.
 await page.click('#stop');assert.ok(!(await page.locator('#mark-holds').isDisabled()));const old=(await snapshot('hold-selection-stopped')).holds.length;await drawHold(page,.25,.1);assert.equal((await snapshot('hold-selection-stopped-edit')).holds.length,old+1);
 await page.locator('#canvas').screenshot({path:'artifacts/hold-selection-fixed.png'});
 // Resume without a fixed camera discards single-frame marks rather than applying stale geometry.
 await page.selectOption('#sample',{index:1});await page.waitForFunction(()=>!document.querySelector('#json').disabled);await page.uncheck('#fixed-camera');await drawHold(page,.2,.1);assert.equal((await snapshot('hold-selection-unfixed')).holds.length,1);await page.click('#play');await page.waitForFunction(()=>!document.querySelector('#video').paused);assert.equal((await snapshot('hold-selection-unfixed-play')).holds.length,0);
 assert.deepEqual(errors,[]);await writeFile('artifacts/hold-selection-report.json',JSON.stringify({passed:true,checks:['draw region while playing','mark without fixed-camera gate','late pose frame discarded','continuous add/delete/undo','color scan without fixed camera','checking fixed camera preserves candidates','confirmed playback','stopped frame editable','unfixed playback discards still-only marks'],errors},null,2));console.log('Direct hold selection and editable-frame regression passed.');
}finally{await browser.close();}
