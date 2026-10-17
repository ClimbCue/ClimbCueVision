import test from 'node:test';
import assert from 'node:assert/strict';
import {contains,polygonInfo,polygonDistance} from '../static/segment-math.js';
import {holdProximity} from '../static/climbing-math.js';
const square=[[.2,.2],[.6,.2],[.6,.6],[.2,.6]];
test('outline centroid and projected area are independent of vertex density and winding',()=>{
 for(const p of [square,[...square].reverse(),[[.2,.2],[.21,.2],[.22,.2],...square.slice(1)]]){
  const g=polygonInfo(p);assert.ok(Math.abs(g.center.x-.4)<1e-10);assert.ok(Math.abs(g.area_fraction-.16)<1e-10);assert.deepEqual(g.bbox,[.2,.2,.6,.6]);
 }
});
test('concave mask label stays inside outline even if centroid is outside',()=>{
 const p=[[0,0],[1,0],[1,.1],[.1,.1],[.1,.9],[1,.9],[1,1],[0,1]];
 assert.ok(!contains({x:.5,y:.5},p));assert.ok(contains(polygonInfo(p).center,p));
});
test('outline distance uses pixel aspect ratio, interior and closed edges',()=>{
 assert.equal(polygonDistance({x:.3,y:.3},square,100,200),0);
 assert.ok(Math.abs(polygonDistance({x:.7,y:.4},square,100,200)-10)<1e-10);
 assert.ok(Math.abs(polygonDistance({x:.4,y:.7},square,100,200)-20)<1e-10);
});
test('limb proximity uses confirmed contour rather than distant mask center',()=>{
 const points=Array(33).fill(null);points[15]={x:.59,y:.4,visibility:1};
 const hold={id:1,x:.4,y:.4,visibility:1,polygon:square};
 assert.equal(holdProximity(points,[hold],{torsoPixels:30},100,200,true).leftHand.id,1);
 assert.equal(holdProximity(points,[{...hold,polygon:null}],{torsoPixels:30},100,200,true).leftHand,null);
 assert.equal(holdProximity(points,[hold],{torsoPixels:30},100,200,false).leftHand,null);
});
