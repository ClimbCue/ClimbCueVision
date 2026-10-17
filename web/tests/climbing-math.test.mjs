import {test} from 'node:test';
import assert from 'node:assert/strict';
import {climbingMetrics,MotionTracker,holdProximity} from '../static/climbing-math.js';
import {metrics,toCSV} from '../static/pose-math.js';
function body(dx=0,dy=0){
 const p=Array.from({length:33},()=>({x:.5+dx,y:.2+dy,visibility:1}));
 for(const [i,x,y] of [[11,.4,.3],[12,.6,.3],[13,.3,.35],[14,.7,.35],[15,.2,.4],[16,.8,.4],[23,.43,.55],[24,.57,.55],[25,.43,.7],[26,.57,.7],[27,.43,.85],[28,.57,.85],[31,.4,.88],[32,.6,.88]])p[i]={x:x+dx,y:y+dy,visibility:1};
 return p;
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('center is an explicit geometric proxy; metric distances are aspect corrected',()=>{
 const c=climbingMetrics(body(),720,1280);
 close(c.center.x,.5);close(c.center.y,.425);close(c.torsoPixels,320);
 close(c.handSpan,.6*720/320);close(c.hipFootOffset,0);close(c.leftLegExtension,1);
 assert.ok(c.leftHip>160);assert.ok(c.leftAnkle>0);
});
test('normalized measures are invariant to image resize and translation',()=>{
 const a=climbingMetrics(body(),720,1280),b=climbingMetrics(body(.02,.02),360,640);
 for(const key of ['handSpan','footSpan','hipFootOffset','leftArmExtension','rightLegExtension','leftHip'])close(a[key],b[key]);
});
test('missing points, zero torso and invalid dimensions produce missing observations',()=>{
 const p=body();p[11].visibility=0;
 assert.equal(climbingMetrics(p,720,1280).center,null);
 assert.equal(climbingMetrics(p,720,1280).leftArmExtension,null);
 const flat=body().map(()=>({x:.5,y:.5,visibility:1}));
 assert.equal(climbingMetrics(flat,720,1280).torsoPixels,null);
 for(const c of [climbingMetrics([],720,1280),climbingMetrics(body(),0,0)])assert.ok(Object.values(c).every(x=>x===null));
});
test('fixed-camera gate prevents uncalibrated motion and hold claims',()=>{
 const p=body(),c=climbingMetrics(p,720,1280),t=new MotionTracker();
 assert.equal(t.update(p,c,1,720,1280,false).centerSpeed,null);
 assert.ok(Object.values(holdProximity(p,[{...p[15],id:1}],c,720,1280,false)).every(v=>v===null));
});
test('known upward translation yields positive normalized vertical speed',()=>{
 const t=new MotionTracker();let m;
 for(let i=0;i<=10;i++){const p=body(0,-i*.001);m=t.update(p,climbingMetrics(p,720,1280),i*.05,720,1280,true);}
 close(m.verticalSpeed,.08);close(m.centerSpeed,.08);
});
test('stillness requires continuity and visible limbs, not merely a stationary torso',()=>{
 const t=new MotionTracker();let m;
 for(let i=0;i<=30;i++){const p=body();m=t.update(p,climbingMetrics(p,720,1280),i*.05,720,1280,true);}
 assert.equal(m.movement,'pause_candidate');assert.ok(m.stillSeconds>=.8);
 const missing=body();missing[15].visibility=.1;
 m=t.update(missing,climbingMetrics(missing,720,1280),1.55,720,1280,true);
 assert.equal(m.movement,'unknown');assert.equal(m.stillSeconds,null);
});
test('moving hand with a stationary center does not count as a pause',()=>{
 const t=new MotionTracker();let m;
 for(let i=0;i<=20;i++){const p=body();p[15].x+=i*.005;m=t.update(p,climbingMetrics(p,720,1280),i*.05,720,1280,true);}
 close(m.centerSpeed,0);assert.equal(m.movement,'moving');
});
test('seek, loop, detection loss and long gaps reset temporal history',()=>{
 const t=new MotionTracker(),p=body(),c=climbingMetrics(p,720,1280);
 for(const end of [-1,2]){t.update(p,c,0,720,1280,true);t.update(p,c,.3,720,1280,true);assert.equal(t.update(p,c,end,720,1280,true).centerSpeed,null);t.reset();}
 t.update(p,c,0,720,1280,true);t.update([],climbingMetrics([],720,1280),.1,720,1280,true);
 assert.equal(t.update(p,c,.4,720,1280,true).centerSpeed,null);
});
test('hold proximity respects visibility and normalized radius without asserting contact',()=>{
 const p=body(),c=climbingMetrics(p,720,1280),holds=[{...p[15],id:4},{x:.9,y:.1,visibility:1,id:9}];
 const result=holdProximity(p,holds,c,720,1280,true);
 assert.equal(result.leftHand.id,4);assert.equal(result.rightHand,null);
 p[15].visibility=.2;assert.equal(holdProximity(p,holds,c,720,1280,true).leftHand,null);
});
test('CSV contains observation units, model and missing values in aligned columns',()=>{
 const p=body(),c=climbingMetrics(p,720,1280);
 const f={frame:1,video_seconds:0,inference_ms:20,width:720,height:1280,model:'full',fixed_camera:true,landmarks:p,metrics:metrics(p,720,1280),climbing:c,motion:{},proximity:{}};
 const rows=toCSV([f]).split('\n').map(x=>x.split(','));
 assert.ok(rows.every(x=>x.length===rows[0].length));assert.ok(rows[0].includes('center_proxy_x'));assert.ok(rows[0].includes('center_speed_torso_s'));
 assert.equal(rows[1][rows[0].indexOf('center_speed_torso_s')],'');
});
