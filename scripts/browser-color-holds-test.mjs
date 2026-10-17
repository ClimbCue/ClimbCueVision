import {drawHold} from './helpers/hold-regions.mjs';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {polygonInfo} from '../web/static/segment-math.js';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1200},acceptDownloads:true});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/holds/color'))requests.push(r.url());});
async function clickPoint(p){await page.locator('#canvas').scrollIntoViewIfNeeded();const b=await page.locator('#canvas').boundingBox();await page.mouse.click(b.x+p.x*b.width,b.y+p.y*b.height);}
async function snap(name){const pending=page.waitForEvent('download');await page.click('#json');await(await pending).saveAs(`artifacts/${name}.json`);return JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));}
async function scan(action){const response=page.waitForResponse(r=>r.url().includes('/api/holds/color'),{timeout:20000});await action();const r=await response;assert.ok(r.ok());const result=await r.json();await page.waitForFunction(()=>document.querySelector('#color-status').textContent.startsWith('找到')&&!document.querySelector('#color-scan').disabled);return result;}
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);assert.ok(!(await page.locator('#sam-tools').evaluate(e=>e.open)));await page.check('#fixed-camera');await page.selectOption('#sample',{index:2});await page.waitForFunction(()=>document.querySelector('#video').currentTime>=3&&!document.querySelector('#json').disabled);
 const red=await scan(()=>page.getByRole('button',{name:'选择红色岩点',exact:true}).click());assert.ok(red.polygons.length>=4,JSON.stringify(red));assert.ok(await page.locator('#video').evaluate(v=>v.paused));
 let current=await snap('color-red-candidates');assert.equal(current.segmentation.model,'color-hsv');assert.equal(current.holds.length,0);assert.equal(await page.locator('#segment-candidates input:checked').count(),red.polygons.length);
 const center=polygonInfo(red.polygons[0]).center;await clickPoint(center);assert.equal(await page.locator('#segment-candidates input:checked').count(),red.polygons.length-1);await clickPoint(center);
 // Manual additions coexist with auto proposals; deleting and undoing keeps IDs stable.
 await page.click('#mark-holds');await drawHold(page,.25,.1);current=await snap('color-manual-add');assert.equal(current.holds.length,1);assert.equal(current.holds[0].source,'manual');const manual=current.holds[0];await clickPoint(manual);await page.click('#delete-hold');assert.equal((await snap('color-manual-delete')).holds.length,0);await page.click('#undo-hold');assert.deepEqual((await snap('color-manual-undo')).holds,[manual]);
 // Add another color; a rescan must not erase manual work.
 const multi=await scan(()=>page.getByRole('button',{name:'选择蓝色岩点',exact:true}).click());assert.ok(multi.polygons.length>red.polygons.length);assert.deepEqual((await snap('color-multiple')).holds,[manual]);
 // Mirrored eyedropper samples the original frame, not the drawn skeleton or highlights.
 await page.check('#mirror');await page.click('#color-pick');const picked=await scan(()=>clickPoint({x:1-.82,y:.61}));assert.equal(picked.colors.length,3);const rgb=picked.colors.at(-1).slice(1).match(/../g).map(v=>parseInt(v,16));assert.ok(rgb[1]>rgb[0]&&rgb[1]>rgb[2],`Expected original green hold, got ${picked.colors.at(-1)}`);await page.uncheck('#mirror');
 await page.locator('#canvas').screenshot({path:'artifacts/color-holds-candidates.png'});await page.screenshot({path:'artifacts/color-holds-desktop.png',fullPage:true});
 const selected=await page.locator('#segment-candidates input:checked').count();await page.click('#holds-play');await page.waitForFunction(()=>!document.querySelector('#video').paused);const before=await snap('color-playing-before'),at=requests.length;await page.waitForTimeout(1300);const after=await snap('color-playing-after');assert.equal(before.holds.length,selected+1);assert.deepEqual(after.holds,before.holds);assert.ok(after.frame>before.frame+10);assert.equal(requests.length,at);assert.ok(after.holds.some(h=>h.source==='color-hsv')&&after.holds.some(h=>h.source==='manual'));
 // Color scan + SAM additions keep per-candidate provenance.
 await page.click('#sam-tools summary');await page.click('#segment-click');await clickPoint({x:.57,y:.35});await page.waitForFunction(()=>/个候选|分割失败/.test(document.querySelector('#segment-status').textContent)&&!document.querySelector('#segment-click').disabled,null,{timeout:120000});
 // Rescanning must preserve already confirmed IDs, including manual points.
 await scan(()=>page.click('#color-scan'));assert.deepEqual((await snap('color-rescan')).holds,before.holds);
 // A delayed color response cannot overwrite a resumed video.
 let release;await page.route('**/api/holds/color?*',async route=>{await new Promise(r=>release=r);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...red,model:'color-hsv'})});});await page.click('#color-scan');for(let n=0;n<50&&!release;n++)await page.waitForTimeout(100);assert.ok(release);await page.click('#play');release();await page.waitForTimeout(400);assert.equal(await page.locator('#segment-candidates input').count(),0);assert.ok(!(await page.locator('#color-status').textContent()).includes('正在'));await page.unroute('**/api/holds/color?*');
 await page.setViewportSize({width:390,height:844});await page.locator('.hold-setup').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/color-holds-mobile.png'});
 assert.deepEqual(errors,[]);await writeFile('artifacts/color-holds-report.json',JSON.stringify({passed:true,red_candidates:red.polygons.length,multicolor_candidates:multi.polygons.length,color_inference_ms:red.inference_ms,confirmed_holds:before.holds.length,live_frames:after.frame-before.frame,color_requests_during_play:0,checks:['preset multi-color proposals','click to deselect','manual add/delete/undo','manual survives rescan','mirrored raw-frame eyedropper','confirm all and play','confirmed geometry preserved','late response discarded','390px layout'],errors},null,2));console.log('Color auto marking + manual edits + playback passed.',red.polygons.length,multi.polygons.length);
}finally{await browser.close();}
