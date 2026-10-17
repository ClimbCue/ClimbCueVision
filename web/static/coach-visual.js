import {EDGES} from './pose-math.js';
const ENDPOINTS={leftHand:15,rightHand:16,leftFoot:31,rightFoot:32};
const LIMBS={leftHand:'左手',rightHand:'右手',leftFoot:'左脚',rightFoot:'右脚'};
export function initCoachVisual(){
 const $=id=>document.getElementById(id),canvas=$('coach-snapshot');
 const overlay=$('coach-overlay'),holdLayer=$('coach-show-holds'),dialog=$('coach-zoom-dialog'),large=$('coach-zoom-canvas');
 let snapshot=null,picture=null,action=null,version=0,inspected=null;
 function draw(target){
  if(!snapshot||!picture)return;
  target.width=picture.naturalWidth;target.height=picture.naturalHeight;
  const ctx=target.getContext('2d'),w=target.width,h=target.height;
  ctx.drawImage(picture,0,0);
  // Keep labels and strokes readable in CSS pixels, including portrait thumbnails.
  const rect=target.getBoundingClientRect(),scale=Math.max(.05,Math.min(rect.width/w,rect.height/h));
  const px=n=>n/scale,points=snapshot.points;
  const valid=p=>p&&p.visibility>=.5&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  if(overlay.checked){
   ctx.lineWidth=px(1.8);ctx.strokeStyle='#8de9bb';
   for(const [a,b] of EDGES){if(!valid(points[a])||!valid(points[b]))continue;ctx.beginPath();ctx.moveTo(points[a].x*w,points[a].y*h);ctx.lineTo(points[b].x*w,points[b].y*h);ctx.stroke();}
  }
  if(holdLayer.checked)for(const hold of snapshot.holds){
   const selected=hold.id===action?.target_hold_id,viewed=hold.id===inspected;
   const color=selected?'#ffce65':viewed?'#fff':'#27dcff';
   ctx.lineWidth=px(viewed?3.5:2.5);ctx.strokeStyle=color;ctx.fillStyle=selected?'rgba(255,206,101,.25)':'rgba(39,220,255,.22)';
   if(hold.polygon?.length){
    ctx.beginPath();hold.polygon.forEach(([x,y],i)=>i?ctx.lineTo(x*w,y*h):ctx.moveTo(x*w,y*h));ctx.closePath();ctx.fill();
    ctx.save();ctx.lineWidth=px(5);ctx.strokeStyle='rgba(0,0,0,.65)';ctx.stroke();ctx.restore();ctx.stroke();
   }
   ctx.beginPath();ctx.arc(hold.x*w,hold.y*h,px(selected||viewed?8:6),0,Math.PI*2);ctx.stroke();
   ctx.font=`bold ${px(14)}px sans-serif`;const label='#'+hold.id,pad=px(4),lw=ctx.measureText(label).width;
   const x=Math.max(pad,Math.min(w-lw-pad*2,hold.x*w+px(10))),y=Math.max(px(22),Math.min(h-px(5),hold.y*h-px(9)));
   ctx.fillStyle='#092d36';ctx.fillRect(x-pad,y-px(16),lw+pad*2,px(21));ctx.fillStyle=color;ctx.fillText(label,x,y);
  }
  const endpoint=points[ENDPOINTS[action?.limb]];
  if(overlay.checked&&valid(endpoint)){
   ctx.strokeStyle='#ffce65';ctx.lineWidth=px(3);ctx.beginPath();ctx.arc(endpoint.x*w,endpoint.y*h,px(10),0,Math.PI*2);ctx.stroke();
   const hold=snapshot.holds.find(h=>h.id===action?.target_hold_id);
   if(holdLayer.checked&&action.action==='test_move'&&hold){
    const x=endpoint.x*w,y=endpoint.y*h,tx=hold.x*w,ty=hold.y*h,a=Math.atan2(ty-y,tx-x);
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.lineTo(tx-px(12)*Math.cos(a-.5),ty-px(12)*Math.sin(a-.5));ctx.moveTo(tx,ty);ctx.lineTo(tx-px(12)*Math.cos(a+.5),ty-px(12)*Math.sin(a+.5));ctx.stroke();
   }
  }
 }
 function paint(){draw(canvas);if(dialog.open)draw(large);}
 function holdStatus(){
  if(!snapshot)return;
  const n=snapshot.holds.length;
  $('coach-hold-status').textContent=n?`${n} 个已确认岩点${holdLayer.checked?' · 轮廓与编号已显示':' · 图层已隐藏，勾选“显示岩点”可恢复'}`:'本次快照没有已确认岩点。先在上方选颜色或手动标记，确认候选后再分析。';
  $('coach-hold-list').replaceChildren(...snapshot.holds.map(h=>{
   const b=document.createElement('button');b.className='btn small';b.textContent=`查看 #${h.id} · ${h.polygon?.length?'轮廓':'手动点'}`;
   b.setAttribute('aria-pressed',String(inspected===h.id));b.onclick=()=>{inspected=h.id;holdLayer.checked=true;holdStatus();paint();};return b;
  }));
 }
 overlay.onchange=paint;holdLayer.onchange=()=>{holdStatus();paint();};
 $('coach-zoom').onclick=()=>{if(!picture)return;dialog.showModal();paint();};
 $('coach-zoom-close').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
 new ResizeObserver(()=>paint()).observe($('coach-frame-stage'));
 window.addEventListener('resize',paint);
 return {
  show(saved,plan=null){
   snapshot=saved;action=plan;inspected=null;const token=++version;
   picture=null;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);$('coach-zoom').disabled=true;
   $('coach-snapshot-empty').hidden=true;canvas.hidden=false;
   $('coach-snapshot-caption').textContent=`第 ${saved.frame} 帧 · ${saved.videoSeconds.toFixed(2)} 秒 · ${saved.holds.length} 个岩点 · 原始画面坐标`;
   $('coach-focus').textContent=plan?.limb?`本次关注：${LIMBS[plan.limb]}${plan.target_hold_id?' → #'+plan.target_hold_id:''}`:plan?.target_hold_id?`本次关注：岩点 #${plan.target_hold_id}`:'绿色：姿态 · 蓝色：岩点 · 黄色：本次关注';
   holdStatus();
   const img=new Image();img.onload=()=>{if(token!==version)return;picture=img;$('coach-zoom').disabled=false;paint();};img.src=saved.rawImage;
  },
  clear(){version++;snapshot=null;picture=null;action=null;inspected=null;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;if(dialog.open)dialog.close();$('coach-zoom').disabled=true;$('coach-hold-list').replaceChildren();$('coach-hold-status').textContent='分析后显示本次快照中的岩点编号和轮廓。';$('coach-snapshot-empty').hidden=false;$('coach-snapshot-caption').textContent='分析时保留同一帧，方便对照人体姿态和岩点';$('coach-focus').textContent='绿色：姿态 · 蓝色：岩点 · 黄色：本次关注';},
 };
}
