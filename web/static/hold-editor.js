import {contains, polygonInfo} from './segment-math.js';

// Coordinates always refer to the original image, including mirrored previews.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function transformRegion(polygon,start,end,corner=null){
 const [x0,y0,x1,y1]=polygonInfo(polygon).bbox;
 if(corner===null){
  const dx=clamp(end.x-start.x,-x0,1-x1),dy=clamp(end.y-start.y,-y0,1-y1);
  return polygon.map(([x,y])=>[x+dx,y+dy]);
 }
 const left=corner===0||corner===3,top=corner<2;
 const ax=left?x1:x0,ay=top?y1:y0;
 const ex=left?clamp(end.x,0,ax-.002):clamp(end.x,ax+.002,1);
 const ey=top?clamp(end.y,0,ay-.002):clamp(end.y,ay+.002,1);
 const sx=(ex-ax)/((left?x0:x1)-ax),sy=(ey-ay)/((top?y0:y1)-ay);
 return polygon.map(([x,y])=>[clamp(ax+(x-ax)*sx),clamp(ay+(y-ay)*sy)]);
}

export function drawnRegion(points,width,height){
 // Remove tiny input jitter, then bound payload size for the coaching contract.
 const clean=[];
 for(const p of points)if(!clean.length||Math.hypot((p[0]-clean.at(-1)[0])*width,(p[1]-clean.at(-1)[1])*height)>=2)clean.push(p);
 if(clean.length>2&&Math.hypot((clean[0][0]-clean.at(-1)[0])*width,(clean[0][1]-clean.at(-1)[1])*height)<3)clean.pop();
 const polygon=clean.filter((_,i)=>i%Math.ceil(clean.length/128)===0);
 if(polygon.length<3||polygonInfo(polygon).area_fraction*width*height<16)return null;
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let i=0;i<polygon.length;i++)for(let j=i+2;j<polygon.length;j++){
  if(i===0&&j===polygon.length-1)continue;
  const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[j],d=polygon[(j+1)%polygon.length];
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return null;
 }
 return polygon;
}

export function initHoldEditor({canvas,getHolds,enabled,toPoint,pause,commit,remove,repaint,status,enter}){
 const $=id=>document.getElementById(id),mode=$('hold-edit-mode');
 let selected=null,gesture=null,replacement=null,suppressClick=false;
 const current=()=>getHolds().find(h=>h.id===selected);
 const corners=p=>{const [a,b,c,d]=polygonInfo(p).bbox;return [[a,b],[c,b],[c,d],[a,d]];};
 function sync(){
  if(!current())selected=null;
  const ok=enabled(),h=current();
  mode.disabled=!ok;
  $('delete-hold').disabled=$('redraw-hold').disabled=!ok||!h;
  $('hold-current').textContent=mode.value==='draw'?(replacement?`正在重画 #${replacement} · 沿新边缘画一圈，Esc 取消`:'沿岩点边缘画一圈，松开保存完整区域'):h?`选中 #${h.id} · 拖动区域移动，拖动四角缩放`:'点击岩点识别区域；也可选择手动画轮廓';
  canvas.classList.toggle('region-drawing',ok&&mode.value==='draw');
 }
 function select(id){selected=id;sync();repaint();}
 function cancel(){
  if(gesture){const id=gesture.pointerId;gesture=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);suppressClick=true;}
  replacement=null;repaint();
 }
 mode.onchange=()=>{cancel();enter();pause();sync();status(mode.value==='draw'?'按住鼠标或手指沿岩点边缘画一圈，松开闭合保存。':'点击岩点识别区域；点已有区域选中，可拖动、缩放或删除。');};
 $('redraw-hold').onclick=()=>{if(!current())return;cancel();replacement=selected;mode.value='draw';enter();pause();sync();status(`沿 #${selected} 的新边缘画一圈，松开替换原轮廓；Esc 取消。`);};
 $('delete-hold').onclick=()=>{if(!current())return;cancel();remove(selected);selected=null;sync();repaint();};
 canvas.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 canvas.addEventListener('pointerdown',event=>{
  suppressClick=false;
  if(!enabled()||event.button!==0||!event.isPrimary)return;
  const p=toPoint(event),r=canvas.getBoundingClientRect(),h=current();
  let corner=-1;
  if(h?.polygon&&mode.value!=='draw')corner=corners(h.polygon).findIndex(([x,y])=>Math.hypot((x-p.x)*r.width,(y-p.y)*r.height)<=12);
  const hit=corner>=0?h:getHolds().filter(h=>h.polygon&&contains(p,h.polygon)).sort((a,b)=>a.area_fraction-b.area_fraction)[0];
  if(mode.value==='draw')gesture={type:'draw',points:[[p.x,p.y]],id:replacement};
  else if(hit){selected=hit.id;gesture={type:'transform',polygon:hit.polygon.map(p=>[...p]),id:hit.id,corner:corner>=0?corner:null};}
  else return;
  enter();pause();gesture.start=p;gesture.pointerId=event.pointerId;gesture.changed=false;
  canvas.setPointerCapture(event.pointerId);event.preventDefault();sync();repaint();
 });
 canvas.addEventListener('pointermove',event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  const p=toPoint(event),r=canvas.getBoundingClientRect();
  if(Math.hypot((p.x-gesture.start.x)*r.width,(p.y-gesture.start.y)*r.height)>3)gesture.changed=true;
  if(gesture.type==='draw')gesture.points.push([p.x,p.y]);
  else gesture.preview=transformRegion(gesture.polygon,gesture.start,p,gesture.corner);
  repaint();
 });
 canvas.addEventListener('pointerup',event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  const g=gesture;gesture=null;suppressClick=true;
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(g.type==='draw'){
   const end=toPoint(event);g.points.push([end.x,end.y]);
   const r=canvas.getBoundingClientRect(),polygon=drawnRegion(g.points,r.width,r.height);
   if(polygon){const id=commit(polygon,g.id);if(id!==null){selected=id;replacement=null;mode.value='auto';status('区域已保存。拖动可移动，四角可缩放；可重画边界或删除所选。');}}
   else status('请沿岩点边缘画出闭合区域，避免交叉或只点击一个点；尚未保存。');
  }else if(g.changed){selected=commit(transformRegion(g.polygon,g.start,toPoint(event),g.corner),g.id);status('岩点区域已调整，可撤销上一步。');}
  sync();repaint();
 });
 canvas.addEventListener('pointercancel',()=>cancel());
 canvas.addEventListener('lostpointercapture',()=>{if(gesture)cancel();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){cancel();mode.value='auto';sync();repaint();}});
 function draw(ctx,px){
  if(!enabled())return;
  const h=current(),polygon=gesture?.preview||h?.polygon;
  if(polygon){
   ctx.save();ctx.shadowBlur=0;ctx.beginPath();polygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*canvas.width,y*canvas.height));ctx.closePath();
   ctx.fillStyle='rgba(255,215,95,.25)';ctx.fill();ctx.strokeStyle='#ffdc76';ctx.lineWidth=px(3);ctx.stroke();
   const cs=corners(polygon);ctx.beginPath();cs.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*canvas.width,y*canvas.height));ctx.closePath();ctx.setLineDash([px(4),px(4)]);ctx.lineWidth=px(1);ctx.stroke();ctx.setLineDash([]);
   for(const [x,y] of cs){ctx.fillStyle='#fff';ctx.fillRect(x*canvas.width-px(5),y*canvas.height-px(5),px(10),px(10));ctx.strokeStyle='#153e32';ctx.strokeRect(x*canvas.width-px(5),y*canvas.height-px(5),px(10),px(10));}ctx.restore();
  }
  if(gesture?.type==='draw'){
   ctx.save();ctx.beginPath();gesture.points.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*canvas.width,y*canvas.height));ctx.closePath();ctx.fillStyle='rgba(255,215,95,.25)';ctx.fill();ctx.strokeStyle='#ffdc76';ctx.lineWidth=px(3);ctx.stroke();ctx.restore();
  }
 }
 return {sync,select,cancel,draw,reset(){cancel();selected=null;mode.value='auto';sync();repaint();},get drawing(){return !!gesture;}};
}
