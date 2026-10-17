import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {drawHold,clickHold} from './helpers/hold-regions.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
async function snapshot(name,selector='#json'){
 const pending=page.waitForEvent('download');await page.click(selector);
 const path=`artifacts/hold-regions-${name}.json`;await(await pending).saveAs(path);return JSON.parse(await readFile(path,'utf8'));
}
async function drag(from,to){
 await page.locator('#canvas').scrollIntoViewIfNeeded();const r=await page.locator('#canvas').boundingBox();
 await page.mouse.move(r.x+from[0]*r.width,r.y+from[1]*r.height);await page.mouse.down();
 await page.mouse.move(r.x+to[0]*r.width,r.y+to[1]*r.height,{steps:12});await page.mouse.up();
}
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.selectOption('#coach-mode','preview');await page.selectOption('#sample',{index:2});
 await page.waitForFunction(()=>!document.querySelector('#json').disabled&&document.querySelector('#video').currentTime>=3);
 // The original click workflow now produces a real local SAM contour, never a dot.
 await clickHold(page,.57,.35);
 await page.waitForFunction(()=>document.querySelector('#hold-count').textContent==='1 个标记',null,{timeout:120000});
 let first=(await snapshot('sam')).holds[0];assert.ok(first.polygon.length>=3);assert.match(first.source,/manual-/);
 assert.ok(first.area_fraction>0&&first.area_fraction<.15);assert.ok(await page.locator('#video').evaluate(v=>v.paused));
 // Selecting an existing outline does not delete it. Delete and undo preserve full geometry.
 await clickHold(page,first.x,first.y);assert.equal((await snapshot('selected')).holds.length,1);
 await page.click('#delete-hold');assert.equal((await snapshot('deleted')).holds.length,0);
 await page.click('#undo-hold');assert.deepEqual((await snapshot('undo')).holds,[first]);
 // Freehand area creation, whole-outline translation and resize.
 await drawHold(page,.25,.12,.07,.045);let h=(await snapshot('drawn')).holds.at(-1);
 assert.equal(h.source,'manual');assert.ok(h.polygon.length>=3);assert.ok(Math.abs(h.x-.25)<.01);
 await drag([h.x,h.y],[h.x+.08,h.y+.06]);let moved=(await snapshot('moved')).holds.at(-1);
 assert.equal(moved.id,h.id);assert.ok(Math.abs(moved.x-h.x-.08)<.005);assert.ok(Math.abs(moved.area_fraction-h.area_fraction)<1e-8);
 const [x0,y0,x1,y1]=moved.bbox;await drag([x1,y1],[x1+.06,y1+.04]);let resized=(await snapshot('resized')).holds.at(-1);
 assert.ok(resized.area_fraction>moved.area_fraction);assert.equal(resized.id,h.id);
 await page.click('#undo-hold');assert.deepEqual((await snapshot('undo-resize')).holds.at(-1),moved);
 // Redraw replaces the selected region with the same ID rather than adding a marker.
 await clickHold(page,moved.x,moved.y);await page.click('#redraw-hold');
 await page.locator('#canvas').scrollIntoViewIfNeeded();
 const r=await page.locator('#canvas').boundingBox();
 await page.mouse.move(r.x+.32*r.width,r.y+.15*r.height);await page.mouse.down();
 for(const [x,y] of [[.4,.16],[.39,.23],[.32,.22],[.32,.15]])await page.mouse.move(r.x+x*r.width,r.y+y*r.height,{steps:6});await page.mouse.up();
 const redrawn=await snapshot('redrawn');assert.equal(redrawn.holds.length,2);assert.equal(redrawn.holds[1].id,h.id);assert.notDeepEqual(redrawn.holds[1].polygon,moved.polygon);
 await page.check('#mirror');await drawHold(page,.2,.72,.06,.04);const mirrored=(await snapshot('mirror')).holds.at(-1);assert.ok(Math.abs(mirrored.x-.8)<.01);
 await page.uncheck('#mirror');
 const contours=await snapshot('contours','#segment-export');assert.equal(contours.holds.length,3);assert.ok(contours.holds.every(h=>h.polygon.length>=3));
 // Same contours appear in the next-step input and visual result, without a paid model call.
 const request=page.waitForRequest(r=>r.url().endsWith('/api/coach/next'));
 await page.click('#coach-run');const input=(await request).postDataJSON();
 await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 assert.deepEqual(input.holds.map(h=>h.polygon),contours.holds.map(h=>h.polygon));
 assert.equal(await page.locator('#coach-hold-list button').count(),3);
 await page.check('#fixed-camera');await page.click('#holds-play');await page.waitForFunction(()=>!document.querySelector('#video').paused);
 const playing=await snapshot('playing');assert.deepEqual(playing.holds,redrawn.holds.concat(mirrored));
 await page.waitForTimeout(500);assert.ok((await snapshot('tracking')).frame>playing.frame);
 await page.click('#play');await clickHold(page,mirrored.x,mirrored.y);
 await page.locator('#canvas').screenshot({path:'artifacts/hold-regions-desktop.png'});
 // Empty SAM result must not fall back to a made-up circle or point.
 await page.route('**/api/models/mobilesam/infer?*',route=>route.fulfill({json:{polygons:[],model:'mobilesam',inference_ms:1,runtime:'test'}}));
 await clickHold(page,.1,.9);await page.waitForFunction(()=>document.querySelector('#hold-status').textContent.includes('未识别到区域'));
 assert.equal((await snapshot('empty-result')).holds.length,3);await page.unroute('**/api/models/mobilesam/infer?*');
 await page.setViewportSize({width:390,height:844});await drawHold(page,.5,.85,.09,.05);
 assert.equal((await snapshot('mobile')).holds.length,4);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Real touch events use pointer capture, so drawing does not scroll the page.
 await page.selectOption('#hold-edit-mode','draw');await page.locator('#canvas').scrollIntoViewIfNeeded();
 const touch=await page.context().newCDPSession(page),box=await page.locator('#canvas').boundingBox();
 const touchPoints=[[.65,.42],[.76,.42],[.76,.49],[.65,.49],[.65,.42]];
 for(let i=0;i<touchPoints.length;i++){const [x,y]=touchPoints[i];await touch.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{x:box.x+x*box.width,y:box.y+y*box.height}]});}
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal((await snapshot('touch')).holds.length,5);
 await page.selectOption('#hold-edit-mode','draw');await page.locator('#canvas').scrollIntoViewIfNeeded();const cancelBox=await page.locator('#canvas').boundingBox();
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cancelBox.x+.5*cancelBox.width,y:cancelBox.y+.5*cancelBox.height}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await snapshot('touch-cancel')).holds.length,5);
 await page.keyboard.press('Escape');
 await page.locator('.hold-region-tools').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/hold-regions-mobile.png'});
 assert.deepEqual(errors,[]);await writeFile('artifacts/hold-regions-report.json',JSON.stringify({passed:true,real_sam_vertices:first.polygon.length,checks:['real SAM manual click','select/delete/undo full mask','freehand polygon','move and resize','redraw keeps ID','mirror coordinates','contour export','coach input and visualization','fixed camera playback','empty mask does not create dot','mobile layout','touch drawing and pointer cancellation'],errors},null,2));
 console.log('Manual hold regions, editing, playback and coaching passed.');
}finally{await browser.close();}
