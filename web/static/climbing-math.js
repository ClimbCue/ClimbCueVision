// Image-plane observations only. No body-mass, force, contact or wall-depth inference.
import {angle,reliable} from './pose-math.js';
import {polygonDistance} from './segment-math.js';
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a,b,w,h)=>Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);
const valid=(points,ids)=>ids.every(i=>reliable(points[i]));
const limbRatio=(p,ids,w,h)=>{
 if(!valid(p,ids))return null;
 const [a,b,c]=ids.map(i=>p[i]),length=distance(a,b,w,h)+distance(b,c,w,h);
 return length>1?distance(a,c,w,h)/length:null;
};
export function climbingMetrics(p=[],w,h){
 const dimensions=Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0;
 if(!dimensions)p=[];
 const shoulders=valid(p,[11,12])?midpoint(p[11],p[12]):null;
 const hips=valid(p,[23,24])?midpoint(p[23],p[24]):null;
 const torsoPixels=shoulders&&hips?distance(shoulders,hips,w,h):null;
 const torso=torsoPixels>=10?torsoPixels:null;
 const center=torso?midpoint(shoulders,hips):null;
 const normalizedDistance=(a,b)=>torso&&valid(p,[a,b])?distance(p[a],p[b],w,h)/torso:null;
 const feet=valid(p,[27,28])?midpoint(p[27],p[28]):null;
 return {center,torsoPixels:torso,
  leftHip:angle(p[11],p[23],p[25],w,h),rightHip:angle(p[12],p[24],p[26],w,h),
  leftShoulder:angle(p[23],p[11],p[13],w,h),rightShoulder:angle(p[24],p[12],p[14],w,h),
  leftAnkle:angle(p[25],p[27],p[31],w,h),rightAnkle:angle(p[26],p[28],p[32],w,h),
  leftArmExtension:limbRatio(p,[11,13,15],w,h),rightArmExtension:limbRatio(p,[12,14,16],w,h),
  leftLegExtension:limbRatio(p,[23,25,27],w,h),rightLegExtension:limbRatio(p,[24,26,28],w,h),
  handSpan:normalizedDistance(15,16),footSpan:normalizedDistance(27,28),
  hipFootOffset:torso&&hips&&feet?(hips.x-feet.x)*w/torso:null,
 };
}
export const LIMBS=[['leftHand',15,'左手腕'],['rightHand',16,'右手腕'],['leftFoot',31,'左脚尖'],['rightFoot',32,'右脚尖']];
export function holdProximity(points,holds,m,w,h,enabled,radius=.2){
 return Object.fromEntries(LIMBS.map(([key,index])=>{
  if(!enabled||!m.torsoPixels||!reliable(points[index]))return [key,null];
  const nearest=holds.filter(reliable).map(hold=>({id:hold.id,distance:(hold.polygon?.length>=3?polygonDistance(points[index],hold.polygon,w,h):distance(points[index],hold,w,h))/m.torsoPixels,basis:hold.polygon?'outline':'center'})).sort((a,b)=>a.distance-b.distance)[0];
  return [key,nearest&&nearest.distance<=radius?nearest:null];
 }));
}
export class MotionTracker{
 constructor(){this.reset();}
 reset(){this.samples=[];this.stillSince=null;}
 update(points,m,time,w,h,enabled){
  const empty={centerSpeed:null,verticalSpeed:null,lateralRange:null,stillSeconds:null,movement:'unknown',trail:[]};
  if(!enabled||!m.center||!Number.isFinite(time)){this.reset();return empty;}
  let previous=this.samples.at(-1);
  if(previous&&(time<=previous.time||time-previous.time>.5)){this.reset();previous=null;}
  const limbs=[15,16,27,28].every(i=>reliable(points[i]))?[15,16,27,28].map(i=>({x:points[i].x,y:points[i].y})):null;
  const current={time,center:m.center,torso:m.torsoPixels,limbs};
  this.samples.push(current);this.samples=this.samples.filter(s=>time-s.time<=2);
  const trail=this.samples.map(s=>s.center);
  // A 0.25–0.5 s baseline reduces frame-to-frame landmark jitter. Not a physical velocity.
  const base=this.samples.find(s=>time-s.time>=.25&&time-s.time<=.5);
  if(!base)return {...empty,trail};
  const dt=time-base.time,scale=(base.torso+m.torsoPixels)/2;
  const centerSpeed=distance(m.center,base.center,w,h)/scale/dt;
  const verticalSpeed=(base.center.y-m.center.y)*h/scale/dt;
  const lateralRange=(Math.max(...this.samples.map(s=>s.center.x))-Math.min(...this.samples.map(s=>s.center.x)))*w/scale;
  let movement='unknown',stillSeconds=null;
  if(limbs&&base.limbs&&this.samples.filter(s=>s.time>=base.time).every(s=>s.limbs)){
   const peak=Math.max(centerSpeed,...limbs.map((p,i)=>distance(p,base.limbs[i],w,h)/scale/dt));
   if(peak<.12){if(this.stillSince==null)this.stillSince=time;stillSeconds=time-this.stillSince;movement=stillSeconds>=.8?'pause_candidate':'low_motion';}
   else{this.stillSince=null;stillSeconds=0;movement='moving';}
  }else this.stillSince=null;
  return {centerSpeed,verticalSpeed,lateralRange,stillSeconds,movement,trail};
 }
}
