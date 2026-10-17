import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/pose');await page.waitForFunction(()=>document.querySelector('#sample').options.length===3);
 await page.selectOption('#coach-mode','preview');await page.selectOption('#sample',{index:2});
 await page.waitForFunction(()=>document.querySelector('#video').currentTime>=3&&!document.querySelector('#coach-run').disabled);
 await page.click('#coach-run');await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled);
 assert.match(await page.locator('#coach-hold-status').textContent(),/没有已确认岩点/);
 await page.getByRole('button',{name:'选择红色岩点',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#color-status').textContent.startsWith('找到'));
 const n=await page.locator('#segment-candidates input:checked').count();assert.ok(n>0);
 await page.waitForFunction(n=>document.querySelector('#coach-run').textContent.includes(`确认 ${n} 个`),n);
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/coach/next')&&r.request().method()==='POST');
 await page.click('#coach-run');const response=await pending,body=response.request().postDataJSON();
 assert.equal(response.status(),200);assert.equal(body.mode,'preview');assert.equal(body.holds.length,n);
 assert.ok(body.holds.every(h=>h.polygon?.length>=3));
 await page.waitForFunction(()=>!document.querySelector('#coach-export').disabled&&!document.querySelector('#coach-zoom').disabled);
 assert.equal(await page.locator('#coach-hold-list button').count(),n);
 assert.match(await page.locator('#coach-hold-status').textContent(),new RegExp(`${n} 个已确认岩点`));
 // Turn off the skeleton so differences can only come from the hold layer.
 await page.uncheck('#coach-overlay');await page.uncheck('#coach-show-holds');
 const raw=await page.locator('#coach-snapshot').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 assert.match(await page.locator('#coach-hold-status').textContent(),/已隐藏/);
 await page.check('#coach-show-holds');
 const changed=await page.locator('#coach-snapshot').evaluate((c,raw)=>{
  const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;
  for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-raw[i])+Math.abs(a[i+1]-raw[i+1])+Math.abs(a[i+2]-raw[i+2])>80)count++;
  return count;
 },raw);assert.ok(changed>500,'Hold outlines and numbers must visibly change pixels');
 await page.uncheck('#coach-show-holds');await page.locator('#coach-hold-list button').first().click();
 assert.ok(await page.locator('#coach-show-holds').isChecked());
 await page.click('#coach-zoom');assert.ok(await page.locator('#coach-zoom-dialog').isVisible());
 assert.ok((await page.locator('#coach-zoom-canvas').boundingBox()).height>500);
 await page.locator('#coach-zoom-dialog').screenshot({path:'artifacts/hold-visibility-large.png'});
 await page.click('#coach-zoom-close');assert.ok(!(await page.locator('#coach-zoom-dialog').isVisible()));
 await page.locator('#coach-results').screenshot({path:'artifacts/hold-visibility-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#coach-results').screenshot({path:'artifacts/hold-visibility-mobile.png'});
 assert.deepEqual(errors,[]);
 const report={passed:true,confirmed_holds:n,hold_overlay_changed_pixels:changed,real_llm_called:false,errors,checks:['empty-hold explanation','selected candidates confirmed on explicit analyze button','polygon transport','numbered hold list','independent hold toggle','visible pixel change','click hold restores layer','enlarged view','mobile layout']};
 await writeFile('artifacts/hold-visibility-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
