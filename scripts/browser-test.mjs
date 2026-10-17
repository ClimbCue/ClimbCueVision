import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CLIMBCUE_TEST_URL||'http://127.0.0.1:8000';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:process.env.CLIMBCUE_BROWSER||'chrome',headless:true,
  args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,permissions:['camera']});
const page=await context.newPage();const errors=[],observations=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text().slice(0,300));});
try{
 await page.goto(base+'/pose');
 await page.waitForFunction(()=>document.querySelector('#sample').options.length>1);
 for(const index of [1,2]){
  await page.selectOption('#sample',{index});
  await page.waitForFunction(()=>document.querySelector('#frame-count').textContent.includes('已处理')||document.querySelector('#status').classList.contains('error'),null,{timeout:70000});
  console.log('pose status:',await page.locator('#status').textContent());
  assert.match(await page.locator('#frame-count').textContent(),/已处理/);
  await page.waitForFunction(()=>Number(document.querySelector('#visible').textContent)>15,null,{timeout:30000});
  await page.waitForFunction(()=>parseInt(document.querySelector('#frame-count').textContent.replace('已处理 ',''))>10);
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelector('#landmarks').textContent.match(/0\.\d{3}/));
  const jsonDownload=page.waitForEvent('download');await page.click('#json');const json=await jsonDownload;await json.saveAs(`artifacts/pose-${index}.json`);
  const data=JSON.parse(await readFile(`artifacts/pose-${index}.json`,'utf8'));assert.equal(data.landmarks.length,33);assert.equal(data.width,720);assert.ok(data.metrics.visible>15);
  observations.push({sample:index,frame:data.frame,inference_ms:data.inference_ms,visible:data.metrics.visible,fps:await page.locator('#fps').textContent(),metrics:data.metrics});
  await page.screenshot({path:`artifacts/pose-${index}.png`,fullPage:true});
  const csvDownload=page.waitForEvent('download');await page.click('#csv');await(await csvDownload).saveAs(`artifacts/pose-${index}.csv`);
  await page.click('#stop');assert.equal(await page.locator('#stop').isDisabled(),true);
 }
 await page.setInputFiles('#upload','testvideos/17c4aca2628ae921a529a54205697a0d.mp4');
 await page.waitForFunction(()=>Number(document.querySelector('#visible').textContent)>15,null,{timeout:30000});
 await page.locator('#seek').fill('80');await page.locator('#seek').dispatchEvent('input');
 await page.waitForFunction(()=>document.querySelector('#video').currentTime>5);
 await page.waitForFunction(()=>document.querySelector('#video').currentTime<2,null,{timeout:15000});
 assert.ok(!(await page.locator('#status').getAttribute('class')).includes('error'));
 await page.click('#stop');
 // A real getUserMedia call with a synthetic camera stream tests the lifecycle,
 // not real-person webcam accuracy.
 await page.click('#camera');
 await page.waitForFunction(()=>document.querySelector('#live-label').textContent==='LIVE CAMERA',null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#frame-count').textContent.includes('已处理'));
 await page.waitForFunction(()=>document.querySelector('#visible').textContent==='0');
 assert.equal(await page.locator('#leftElbow').textContent(),'—');
 const cameraTracks=await page.evaluate(()=>{window.__testStream=document.querySelector('#video').srcObject;return window.__testStream.getTracks().length;});assert.ok(cameraTracks>0);
 await page.click('#stop');assert.ok(await page.evaluate(()=>window.__testStream.getTracks().every(t=>t.readyState==='ended')));
 await page.getByRole('link',{name:/攀岩知识库/}).click();
 await page.waitForFunction(()=>document.querySelector('#total').textContent!=='—');
 await page.getByRole('button',{name:'脚法踩点',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#query-status').textContent.includes('找到'));
 assert.match(await page.locator('#answer').textContent(),/kb\./);
 await page.screenshot({path:'artifacts/knowledge.png',fullPage:true});
 await page.locator('#question').fill('量子计算');await page.click('#ask');
 await page.waitForFunction(()=>document.querySelector('#query-status').textContent.includes('找到 0'));
 assert.match(await page.locator('#answer').textContent(),/没有足够/);
 await page.getByRole('button',{name:'读线视频',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#query-status').textContent.includes('找到'));
 assert.ok(await page.locator('#results a[href*="youtube.com/watch"]').count());
 await page.locator('[data-library="video"]').click();assert.equal(await page.locator('#library .library-item').count(),9);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/knowledge-mobile.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(base+'/pose');await page.screenshot({path:'artifacts/pose-mobile.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const denied=await browser.newContext();await denied.grantPermissions([], {origin:base});
 const deniedPage=await denied.newPage();
 await deniedPage.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});
 await deniedPage.goto(base+'/pose');await deniedPage.click('#camera');
 await deniedPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('未获得摄像头权限'));
 assert.equal(await deniedPage.locator('#camera').isDisabled(),false);await denied.close();
 assert.deepEqual(errors,[]);
 const report={passed:true,browser:await browser.version(),observations,camera:'synthetic getUserMedia lifecycle passed; physical webcam not tested',errors};
 await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:'artifacts/failure.png',fullPage:true});console.error('Status:',await page.locator('body').innerText());throw error;}
finally{await browser.close();}
