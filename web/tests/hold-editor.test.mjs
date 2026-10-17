import test from 'node:test';
import assert from 'node:assert/strict';
import {drawnRegion,transformRegion} from '../static/hold-editor.js';
import {polygonInfo} from '../static/segment-math.js';
const polygon=[[.2,.2],[.4,.2],[.35,.4],[.2,.4]];
test('moving a region clips translation without distorting its shape',()=>{
 const moved=transformRegion(polygon,{x:.3,y:.3},{x:-1,y:2});
 const info=polygonInfo(moved);assert.equal(info.bbox[0],0);assert.equal(info.bbox[3],1);
 assert.ok(Math.abs(info.area_fraction-polygonInfo(polygon).area_fraction)<1e-10);
});
test('resize preserves opposite corner and cannot invert or leave the frame',()=>{
 const resized=transformRegion(polygon,{x:.4,y:.4},{x:.6,y:.6},2);
 assert.deepEqual(resized[0],[.2,.2]);assert.ok(polygonInfo(resized).area_fraction>polygonInfo(polygon).area_fraction);
 for(let corner=0;corner<4;corner++)for(const point of [{x:-1,y:-1},{x:2,y:2}]){
  const result=transformRegion(polygon,{x:0,y:0},point,corner);
  assert.ok(result.flat().every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.ok(polygonInfo(result).area_fraction>0);
 }
});
test('drawing refuses point markers, degenerate lines and crossed contours',()=>{
 assert.equal(drawnRegion([[.2,.2]],400,400),null);
 assert.equal(drawnRegion([[.2,.2],[.3,.3],[.4,.4]],400,400),null);
 assert.equal(drawnRegion([[.1,.1],[.8,.8],[.8,.1],[.2,.8]],400,400),null);
 const region=drawnRegion([...polygon,polygon[0]],400,400);assert.ok(region?.length>=3);
 const dense=Array.from({length:1000},(_,i)=>[.5+.4*Math.cos(i/1000*2*Math.PI),.5+.4*Math.sin(i/1000*2*Math.PI)]);
 assert.ok(drawnRegion(dense,2000,2000).length<=128);
});
