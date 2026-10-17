// Draw a real user-defined region. No test-only marker injection into app state.
export async function drawHold(page,x,y,rx=.035,ry=.025){
 await page.selectOption('#hold-edit-mode','draw');
 await page.locator('#canvas').scrollIntoViewIfNeeded();
 const r=await page.locator('#canvas').boundingBox();
 const points=Array.from({length:17},(_,i)=>[x+rx*Math.cos(i*Math.PI/8),y+ry*Math.sin(i*Math.PI/8)]);
 await page.mouse.move(r.x+points[0][0]*r.width,r.y+points[0][1]*r.height);
 await page.mouse.down();
 for(const [px,py] of points.slice(1))await page.mouse.move(r.x+px*r.width,r.y+py*r.height,{steps:2});
 await page.mouse.up();
}

export async function clickHold(page,x,y){
 await page.locator('#canvas').scrollIntoViewIfNeeded();
 const r=await page.locator('#canvas').boundingBox();
 await page.mouse.click(r.x+x*r.width,r.y+y*r.height);
}
