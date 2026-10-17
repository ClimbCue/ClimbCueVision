import {test} from 'node:test';
import assert from 'node:assert/strict';
import {angle,metrics,reliable,toCSV} from '../static/pose-math.js';
const p=(x,y,visibility=1)=>({x,y,visibility});
test('portrait frame angles use pixels, not distorted normalized space',()=>{
 const a=p(.5,0),b=p(.5,.5),c=p(1,.5);
 assert.equal(angle(a,b,c,720,1280),90);
 const d=p(1,0);
 assert.ok(Math.abs(angle(a,b,d,720,1280)-Math.atan(720/1280)*180/Math.PI)<1e-8);
});
test('occluded, missing, out-of-frame and coincident points do not produce angles',()=>{
 assert.equal(angle(p(0,0),p(.5,.5,.2),p(1,0),100,100),null);
 assert.equal(angle(undefined,p(.5,.5),p(1,0),100,100),null);
 assert.equal(angle(p(.5,.5),p(.5,.5),p(1,0),100,100),null);
 assert.equal(reliable(p(1.1,.5)),false);
 assert.equal(metrics([],720,1280).hip,null);
});
test('hip center requires both hips; a lost person clears every measurement',()=>{
 const pts=Array.from({length:33},()=>p(.5,.5,0));pts[23]=p(.3,.6);pts[24]=p(.7,.6);
 assert.deepEqual(metrics(pts,100,100).hip,{x:.5,y:.6});pts[24].visibility=.1;
 assert.equal(metrics(pts,100,100).hip,null);
 assert.deepEqual(metrics([],100,100),{leftElbow:null,rightElbow:null,leftKnee:null,rightKnee:null,hip:null,tilt:null,visible:0});
});
test('CSV retains landmarks and explicit no-person frames without fake zeros',()=>{
 const f={frame:1,video_seconds:0,inference_ms:10,width:100,height:100,landmarks:[],metrics:metrics([],100,100)};
 const csv=toCSV([f,{...f,frame:2,landmarks:[p(.2,.4)]}]);
 assert.equal(csv.split('\n').length,3);assert.ok(!csv.includes('NaN'));assert.ok(!csv.includes('undefined'));
 assert.match(csv,/,0\.2,0\.4,,1,1,/);
});
