import { NAMES, EDGES, reliable, metrics, toCSV } from './pose-math.js';
import {climbingMetrics,MotionTracker,holdProximity,LIMBS} from './climbing-math.js';
import {contains,polygonInfo} from './segment-math.js';
import {initCoach} from './coach.js?v=hold-visible-20261017';
const $=(id)=>document.getElementById(id);
const video=$('video'),canvas=$('canvas'),ctx=canvas.getContext('2d');
const capture=new OffscreenCanvas(1,1),captureContext=capture.getContext('2d');
let worker,readyPromise,stream,objectURL,session=0,frame=0,sequence=0,frames=[],last=null;
let active=false,busy=false,lastTime=-1,lastCapture=0,raf=0,fpsTimes=[],source='',ready=false;
const MAX_FRAMES=1800;
const tracker=new MotionTracker(),backdrop=new OffscreenCanvas(1,1),backdropCtx=backdrop.getContext('2d');
let holds=[],marking=false,segmenting=false,segmentBusy=false,segmentVersion=0,segmentPolygons=[],segmentMeta=null;
let segmentSelected=new Set();
let collectingPoints=false,promptPoints=[],batchRunning=false,batchVersion=0;
let modelCatalog=[];
let colorPicking=false,colorTimer=null,colorRevision=0,holdUndo=[],freezeEditingFrame=false;
const selectedColors=new Map(),candidateInfo=new Map();
const climbingIDs=['body-center','hip-foot-offset','spans','arm-extension','leg-extension','leftHip','rightHip','leftShoulder','rightShoulder','leftAnkle','rightAnkle','center-speed','vertical-speed','lateral-range','still-seconds',...LIMBS.map(([key])=>key+'Hold')];
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
const pretty=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
const clock=(t)=>Number.isFinite(t)?`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`:'00:00';
function buttons(loading=false){for(const id of ['camera','choose-file','sample','pose-model'])$(id).disabled=loading;}
function clearData(){
  clearSegments();freezeEditingFrame=false;
  frames=[];frame=0;last=null;fpsTimes=[];lastTime=-1;lastCapture=0;tracker.reset();holds=[];holdUndo=[];marking=false;backdrop.width=backdrop.height=1;
  climbingIDs.forEach(id=>$(id).textContent='—');$('motion-state').textContent='等待连续观测';$('hold-count').textContent='0 个标记';$('hold-monitor').textContent='等待标记岩点';canvas.classList.remove('marking');$('mark-holds').textContent='手动补点 / 删点';$('clear-holds').disabled=true;
  ['fps','visible','latency','leftElbow','rightElbow','leftKnee','rightKnee','hip','tilt'].forEach(id=>$(id).textContent='—');
  $('landmarks').replaceChildren();$('frame-count').textContent='尚无采样数据';$('json').disabled=$('csv').disabled=true;
  const chart=$('chart');chart.getContext('2d').clearRect(0,0,chart.width,chart.height);updateSegmentButtons();
}
function stop({clear=false}={}){
  session++;active=false;clearSegments();tracker.reset();$('mark-holds').disabled=true;cancelAnimationFrame(raf);video.pause();updateSegmentButtons();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  video.srcObject=null;video.removeAttribute('src');video.load();
  if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
  $('stop').disabled=true;$('play').disabled=true;$('seek').disabled=true;$('play').textContent='播放';
  $('live-dot').classList.remove('on');$('live-label').textContent='STOPPED';$('pose-state').textContent='已停止';
  if(clear){clearData();ctx.clearRect(0,0,canvas.width,canvas.height);$('empty').hidden=false;}
}
function initialize(){
  if(readyPromise)return readyPromise;
  status('正在加载本地姿态模型…');$('status').classList.add('spinner');
  readyPromise=new Promise((resolve,reject)=>{
    worker=new Worker('/static/pose-worker.js',{type:'module'});
    const timeout=setTimeout(()=>failure(new Error('模型加载超时，请检查本地模型资源。')),150000);
    function failure(error){clearTimeout(timeout);worker?.terminate();worker=null;ready=false;readyPromise=null;$('status').classList.remove('spinner');reject(error);}
    worker.onerror=(event)=>{if(!ready)failure(new Error(event.message||'模型 Worker 加载失败'));else inferenceError(event.message);};
    worker.onmessage=({data})=>{
      if(data.type==='ready'){clearTimeout(timeout);ready=true;$('status').classList.remove('spinner');resolve();}
      else if(data.type==='error'){if(data.session!==undefined&&data.session!==session){busy=false;return;}if(!ready)failure(new Error(data.message));else inferenceError(data.message);}
      else if(data.type==='result'){busy=false;if(data.session===session && active)render(data);else data.bitmap.close();}
    };
    worker.postMessage({type:'init',model:$('pose-model').value});
  });
  return readyPromise;
}
function inferenceError(message){stop();busy=false;worker?.terminate();worker=null;readyPromise=null;ready=false;status(`推理失败：${message}。可重新选择输入重试。`,true);}
async function loadInput(kind,value){
  stop({clear:true});const token=session;buttons(true);source=kind==='camera'?'camera':value.name||value;
  try{
    // Request camera on the user's click, before waiting for model initialization.
    if(kind==='camera'){
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('摄像头需要 localhost 或 HTTPS 安全环境');
      stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
      if(token!==session){stream.getTracks().forEach(t=>t.stop());return;}
      video.srcObject=stream;$('mirror').checked=true;
    }else{
      if(kind==='file'){objectURL=URL.createObjectURL(value);video.src=objectURL;}else video.src=value;
      $('mirror').checked=false;
    }
    video.loop=kind!=='camera';
    await Promise.all([initialize(),new Promise((resolve,reject)=>{
      if(video.readyState>=2){resolve();return;}
      const timer=setTimeout(()=>done(new Error('视频加载超时或格式不支持')),20000);
      const loaded=()=>done(),failed=()=>done(new Error('视频无法解码，请使用 MP4/H.264 或 WebM'));
      function done(error){clearTimeout(timer);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);error?reject(error):resolve();}
      video.addEventListener('loadeddata',loaded,{once:true});video.addEventListener('error',failed,{once:true});
    })]);
    if(token!==session)return;
    await video.play();active=true;busy=false;$('empty').hidden=true;$('stop').disabled=false;$('play').disabled=false;
    $('seek').disabled=kind==='camera';$('live-dot').classList.add('on');$('live-label').textContent=kind==='camera'?'LIVE CAMERA':'VIDEO TRACKING';
    $('play').textContent='暂停';$('dimensions').textContent=`${video.videoWidth} × ${video.videoHeight} / POSE ${$('pose-model').value.toUpperCase()}`;
    status('模型已就绪，正在处理真实画面。单人模式下请尽量让全身保持可见。');
    $('mark-holds').disabled=!$('fixed-camera').checked;updateSegmentButtons();
    raf=requestAnimationFrame(loop);
  }catch(error){if(token===session){stop({clear:true});const reason=error.name==='NotAllowedError'?'未获得摄像头权限。请在浏览器允许摄像头，或选择测试视频。':error.name==='NotFoundError'?'没有可用摄像头，请选择测试视频。':error.message;status(reason,true);}}
  finally{buttons(false);}
}
async function loop(now){
  if(!active)return;
  raf=requestAnimationFrame(loop);
  $('play').textContent=video.paused?'播放':'暂停';
  $('time').textContent=stream?`${clock(video.currentTime)} / LIVE`:`${clock(video.currentTime)} / ${clock(video.duration)}`;
  if(Number.isFinite(video.duration)&&video.duration>0)$('seek').value=100*video.currentTime/video.duration;
  if(busy||video.paused||video.seeking||video.readyState<2||video.currentTime===lastTime||now-lastCapture<1000/Number($('target-fps').value)-2)return;
  busy=true;lastCapture=now;lastTime=video.currentTime;const token=session,time=video.currentTime;
  try{
    const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
    const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
    if(capture.width!==width||capture.height!==height){capture.width=width;capture.height=height;}
    captureContext.drawImage(video,0,0,width,height);
    const bitmap=capture.transferToImageBitmap();
    if(token!==session||!active){bitmap.close();busy=false;return;}
    worker.postMessage({type:'frame',session:token,sequence:++sequence,bitmap,time,timestamp:performance.now()},[bitmap]);
  }catch(error){inferenceError(error.message);}
}
function render(data){
  const {bitmap,landmarks:points}=data;
  if(video.paused&&freezeEditingFrame){bitmap.close();return;}
  if(canvas.width!==bitmap.width||canvas.height!==bitmap.height){canvas.width=bitmap.width;canvas.height=bitmap.height;}
  backdrop.width=bitmap.width;backdrop.height=bitmap.height;backdropCtx.drawImage(bitmap,0,0);bitmap.close();
  const m=metrics(points,video.videoWidth,video.videoHeight),time=performance.now();fpsTimes.push(time);fpsTimes=fpsTimes.filter(t=>time-t<1500);
  $('fps').textContent=fpsTimes.length>1?pretty(1000*(fpsTimes.length-1)/(time-fpsTimes[0]),1):'—';
  $('visible').textContent=(data.native_landmarks||points).filter(reliable).length;$('keypoint-total').textContent=`共 ${data.keypoint_count||33} 个`;$('latency').textContent=pretty(data.inference_ms);
  for(const name of ['leftElbow','rightElbow','leftKnee','rightKnee'])$(name).textContent=pretty(m[name]);
  $('hip').textContent=m.hip?`${pretty(m.hip.x,3)}, ${pretty(m.hip.y,3)}`:'—';$('tilt').textContent=m.tilt==null?'—':pretty(m.tilt,1)+'°';
  $('pose-state').textContent=video.paused?'已暂停':points.length?(m.visible>=12?'追踪中':'部分遮挡'):'未检测到人体';
  const climbing=climbingMetrics(points,video.videoWidth,video.videoHeight);
  const motion=tracker.update(points,climbing,data.time,video.videoWidth,video.videoHeight,$('fixed-camera').checked);
  const proximity=holdProximity(points,holds,climbing,video.videoWidth,video.videoHeight,$('fixed-camera').checked);
  last={model:$('pose-model').value,detected_people:data.people??(points.length?1:0),runtime:data.runtime||'CPU / WASM',schema:data.schema||'mediapipe33',native_landmarks:data.native_landmarks||points,names:data.names||NAMES,keypoint_count:data.keypoint_count||33,roundtrip_ms:data.roundtrip_ms??null,segmentation:segmentMeta,fixed_camera:$('fixed-camera').checked,holds:holds.map(h=>({...h})),climbing,motion,proximity,frame:++frame,video_seconds:data.time,inference_ms:data.inference_ms,width:video.videoWidth,height:video.videoHeight,landmarks:points,metrics:m};
  showClimbing(last);paintFrame();
  frames.push(last);if(frames.length>MAX_FRAMES)frames.shift();
  $('frame-count').textContent=`已处理 ${frame} 帧 · 保留最近 ${frames.length} 帧供导出`;
  $('json').disabled=$('csv').disabled=false;
  // Keep the table, canvas, metrics and exported snapshot on the same frame.
  $('landmarks').replaceChildren(...(data.names||NAMES).map((name,i)=>{
    const tr=document.createElement('tr'),p=(data.native_landmarks||points)[i];tr.classList.toggle('low',!reliable(p));
    for(const text of [`${String(i).padStart(2,'0')} ${name}`,pretty(p?.x,3),pretty(p?.y,3),pretty(p?.visibility,2)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;
  }));
  drawChart();if(frame===1)updateSegmentButtons();
}
function drawChart(){const c=$('chart'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.strokeStyle='#e6ebdf';g.lineWidth=1;
  for(const y of [10,60,110]){g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y);g.stroke();}
  const items=frames.slice(-120);['leftElbow','rightElbow'].forEach((key,index)=>{g.strokeStyle=index?'#b7a66e':'#62925a';g.lineWidth=2;g.beginPath();let pen=false;items.forEach((f,i)=>{const a=f.metrics[key];if(a==null){pen=false;return;}const x=i/119*c.width,y=110-a/180*100;if(pen)g.lineTo(x,y);else g.moveTo(x,y);pen=true;});g.stroke();});}
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('camera').onclick=()=>loadInput('camera');$('choose-file').onclick=()=>$('upload').click();
$('upload').onchange=()=>{const f=$('upload').files[0];if(f)loadInput('file',f);$('upload').value='';};
$('sample').onchange=()=>{if($('sample').value)loadInput('sample',$('sample').value);};
$('stop').onclick=()=>{stop();status('已停止，摄像头已释放。当前数据保留，可导出或选择新输入。');};
async function resumeTracking(){
 try{clearSegments();marking=false;freezeEditingFrame=false;if(!$('fixed-camera').checked){holds=[];holdUndo=[];syncHolds();}paintFrame();await video.play();tracker.reset();fpsTimes=[];canvas.classList.remove('marking');$('mark-holds').textContent='手动补点 / 删点';$('hold-status').textContent=`已保留 ${holds.length} 个岩点，正在逐帧观察身体姿态与二维邻近；需要补点时可再次暂停标记。`;status(holds.length?`正在追踪姿态，保留 ${holds.length} 个岩点并实时更新二维邻近。`:'继续追踪。');updateSegmentButtons();canvas.scrollIntoView({block:'center'});}catch(e){status(e.message,true);}
}
$('play').onclick=()=>{if(video.paused)return resumeTracking();video.pause();$('pose-state').textContent='已暂停';status('已暂停，保留最后一帧数据。');updateSegmentButtons();};
$('seek').oninput=()=>{if(Number.isFinite(video.duration)){video.currentTime=Number($('seek').value)/100*video.duration;lastTime=-1;fpsTimes=[];tracker.reset();clearSegments();if(video.paused)status('进度已调整，点击播放后更新姿态。');}};
$('json').onclick=()=>download(JSON.stringify({model_family:$('pose-model').value,delegate:last?.runtime,source,coordinate_system:'normalized original image; angles in 2D pixel space; z is model-relative depth, not meters; center is shoulder/hip geometric proxy, not center of mass; speeds in projected torso lengths per second; holds indicate proximity only',...last},null,2),'climbcue-pose.json','application/json');
$('csv').onclick=()=>download(toCSV(frames),'climbcue-pose.csv','text/csv;charset=utf-8');
window.addEventListener('pagehide',()=>{stop();worker?.terminate();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){video.pause();$('pose-state').textContent='已暂停';status('页面切到后台，已暂停推理；返回后点击播放继续。');}});
try{const r=await fetch('/api/videos');if(!r.ok)throw new Error('测试视频列表加载失败');for(const [i,item] of (await r.json()).entries()){const option=document.createElement('option');option.value=item.url;option.textContent=`攀爬测试视频 ${String(i+1).padStart(2,'0')}`;$('sample').append(option);}
  const health=await(await fetch('/api/health')).json();if(!health.pose_assets_ready)status('尚未准备模型资源，请在项目根目录运行 npm install 和 npm run setup:pose。',true);
}catch(error){status(error.message,true);}
function showClimbing(f){
 const c=f.climbing,m=f.motion;
 $('hold-monitor').textContent=!$('fixed-camera').checked?`单帧可标记 · ${holds.length} 个岩点；保留标记播放需确认固定机位`:!holds.length?'等待标记岩点':`${video.paused?'已暂停':'实时监测'} · ${holds.length} 个岩点 · ${Object.values(f.proximity).filter(Boolean).length} 处手脚二维邻近`; 
 $('body-center').textContent=c.center?`${pretty(c.center.x,3)}, ${pretty(c.center.y,3)}`:'—';
 $('hip-foot-offset').textContent=pretty(c.hipFootOffset,2);
 $('spans').textContent=`${pretty(c.handSpan,2)} / ${pretty(c.footSpan,2)}`;
 const pct=x=>x==null?'—':pretty(x*100)+'%';
 $('arm-extension').textContent=`${pct(c.leftArmExtension)} / ${pct(c.rightArmExtension)}`;
 $('leg-extension').textContent=`${pct(c.leftLegExtension)} / ${pct(c.rightLegExtension)}`;
 for(const id of ['leftHip','rightHip','leftShoulder','rightShoulder','leftAnkle','rightAnkle'])$(id).textContent=pretty(c[id]);
 for(const [id,key] of [['center-speed','centerSpeed'],['vertical-speed','verticalSpeed'],['lateral-range','lateralRange'],['still-seconds','stillSeconds']])$(id).textContent=pretty(m[key],2);
 const state={unknown:'需要连续清晰观测',moving:'观察到移动',low_motion:'当前位移较小',pause_candidate:'停顿候选 · 不等同于休息或卡点'};
 $('motion-state').textContent=f.fixed_camera?state[m.movement]:'未启用 · 请确认固定机位';
 for(const [key] of LIMBS)$(key+'Hold').textContent=f.proximity[key]?`#${f.proximity[key].id}`:'—';
}
function paintFrame(){
 if(!last)return;
 const points=last.landmarks,c=last.climbing;
 const bounds=canvas.getBoundingClientRect(),displayScale=Math.max(.05,Math.min(bounds.width/canvas.width,bounds.height/canvas.height)),px=n=>n/displayScale;
 ctx.save();if($('mirror').checked){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
 ctx.drawImage(backdrop,0,0);
 function outline(polygon,selected,confirmed=false){ctx.beginPath();polygon.forEach(([x,y],i)=>i?ctx.lineTo(x*canvas.width,y*canvas.height):ctx.moveTo(x*canvas.width,y*canvas.height));ctx.closePath();ctx.fillStyle=confirmed?'rgba(135,235,133,.22)':selected?'rgba(80,190,255,.35)':'rgba(180,190,190,.06)';ctx.fill();ctx.strokeStyle=confirmed?'#adfa88':selected?'#56c5ff':'#829194';ctx.lineWidth=selected||confirmed?2:1;ctx.stroke();}
 if(video.paused||$('fixed-camera').checked){segmentPolygons.forEach((p,i)=>outline(p,segmentSelected.has(i)));for(const h of holds)if(h.polygon)outline(h.polygon,false,true);} 
 for(const [i,p] of promptPoints.entries()){ctx.save();ctx.translate(p[0]*canvas.width,p[1]*canvas.height);ctx.strokeStyle='#ffe17d';ctx.fillStyle='#ffe17d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.stroke();if($('mirror').checked)ctx.scale(-1,1);ctx.font='bold 15px sans-serif';ctx.fillText(`P${i+1}`,10,-8);ctx.restore();}
 ctx.lineWidth=Math.max(2,canvas.width/230);ctx.strokeStyle='#dafa83';ctx.shadowColor='#142c27';ctx.shadowBlur=4;
 for(const [a,b] of EDGES){if(!reliable(points[a])||!reliable(points[b]))continue;ctx.beginPath();ctx.moveTo(points[a].x*canvas.width,points[a].y*canvas.height);ctx.lineTo(points[b].x*canvas.width,points[b].y*canvas.height);ctx.stroke();}
 points.forEach((p,i)=>{if(!reliable(p))return;ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,Math.max(2.5,canvas.width/170),0,Math.PI*2);ctx.fillStyle=i%2?'#e4ff9f':'#ffcd96';ctx.fill();});
 if(video.paused||$('fixed-camera').checked){
  ctx.strokeStyle='#ffbd7b';ctx.beginPath();for(const [i,p] of (last.motion.trail||[]).entries()){if(i)ctx.lineTo(p.x*canvas.width,p.y*canvas.height);else ctx.moveTo(p.x*canvas.width,p.y*canvas.height);}ctx.stroke();
  for(const [key,index] of LIMBS){const near=last.proximity?.[key],hold=holds.find(h=>h.id===near?.id),point=points[index];if(!hold||!reliable(point))continue;ctx.save();ctx.setLineDash([5,5]);ctx.strokeStyle='#7cddff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(point.x*canvas.width,point.y*canvas.height);ctx.lineTo(hold.x*canvas.width,hold.y*canvas.height);ctx.stroke();ctx.restore();}
  for(const hold of holds){const x=hold.x*canvas.width,y=hold.y*canvas.height;ctx.strokeStyle='#27dcff';ctx.lineWidth=px(2.5);ctx.beginPath();ctx.arc(x,y,px(6),0,2*Math.PI);ctx.stroke();ctx.save();ctx.translate(x+px(10),Math.max(px(20),y-px(8)));if($('mirror').checked)ctx.scale(-1,1);ctx.font=`bold ${px(14)}px sans-serif`;const label='#'+hold.id;ctx.fillStyle='#092d36';ctx.fillRect(-px(3),-px(15),ctx.measureText(label).width+px(6),px(20));ctx.fillStyle='#7cecff';ctx.fillText(label,0,0);ctx.restore();}
 }
 for(const [p,color] of [[c.center,'#ffbd7b'],[last.metrics.hip,'#96f3c8']]){if(!p)continue;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,9,0,2*Math.PI);ctx.stroke();}
 ctx.restore();
}
function resetMotionDisplay(){
 tracker.reset();
 ['center-speed','vertical-speed','lateral-range','still-seconds',...LIMBS.map(([key])=>key+'Hold')].forEach(id=>$(id).textContent='—');
 $('motion-state').textContent=$('fixed-camera').checked?'等待连续观测':'未启用 · 请确认固定机位';
}
$('pose-model').onchange=()=>{
 stop({clear:true});worker?.terminate();worker=null;readyPromise=null;ready=false;busy=false;$('sample').value='';
 status(`已选择 ${$('pose-model').value.toUpperCase()}，重新选择摄像头或视频开始测试。`);
};
$('fixed-camera').onchange=()=>{
 if(!$('fixed-camera').checked&&last)pauseForMarking();
 resetMotionDisplay();if(last){last.fixed_camera=$('fixed-camera').checked;last.motion={centerSpeed:null,verticalSpeed:null,lateralRange:null,stillSeconds:null,movement:'unknown',trail:[]};}syncHolds();paintFrame();
 if($('fixed-camera').checked&&selectedColors.size&&!segmentPolygons.length&&!segmentBusy)scheduleColorScan();
};
function pauseForMarking(){video.pause();freezeEditingFrame=!!last;$('pose-state').textContent='已暂停 · 可标记岩点';}
function editPoint(p){
 const hit=holds.find(h=>h.polygon?contains(p,h.polygon):Math.hypot((p.x-h.x)*canvas.width,(p.y-h.y)*canvas.height)<Math.max(10,canvas.width/40));
 if(hit){rememberHolds();holds=holds.filter(h=>h!==hit);syncHolds();paintFrame();return;}
 const candidate=candidateAt(p);if(candidate){toggleCandidate(candidate.i);return;}
 if(holds.length>=100){$('hold-status').textContent='已到 100 个岩点上限，请删除一些标记后再添加。';return;}
 rememberHolds();holds.push({id:nextHoldId(),...p,visibility:1,source:'manual'});syncHolds();paintFrame();
 $('hold-status').textContent=`已标记 ${holds.length} 个岩点。继续点击添加；已有标记点一下删除，可撤销。`;
}
$('mark-holds').onclick=()=>{
 if(!last)return;
 clearTimeout(colorTimer);colorRevision++;pauseForMarking();colorPicking=false;segmenting=false;collectingPoints=false;promptPoints=[];marking=!marking;updateSegmentButtons();canvas.classList.toggle('marking',marking);$('mark-holds').textContent=marking?'完成手动修正':'手动补点 / 删点';$('pose-state').textContent='已暂停';if(marking)canvas.scrollIntoView({block:'center'});
 $('hold-status').textContent=marking?'空白处点击补点；点击已确认岩点删除；点击候选取消或恢复。可撤销上一步。':'修正已保存，可以确认候选并播放监测。';
};
canvas.onclick=event=>{
 if(!last){$('hold-status').textContent='请先选择视频或摄像头，等待画面出现后再点击岩点。';return;}
 if(segmentBusy||batchRunning){$('hold-status').textContent='正在生成候选，请等待完成后再选点；也可清除候选取消当前任务。';return;}
 if(!colorPicking&&!collectingPoints&&!segmenting)pauseForMarking();

 if(colorPicking&&video.paused&&last){
  const p=canvasPoint(event),x=Math.max(0,Math.min(backdrop.width-1,Math.round(p.x*backdrop.width))),y=Math.max(0,Math.min(backdrop.height-1,Math.round(p.y*backdrop.height)));
  const raw=backdropCtx.getImageData(Math.max(0,x-1),Math.max(0,y-1),Math.min(3,backdrop.width-x),Math.min(3,backdrop.height-y)).data;
  const rgb=[0,1,2].map(k=>{const a=[];for(let i=k;i<raw.length;i+=4)a.push(raw[i]);a.sort((a,b)=>a-b);return a[Math.floor(a.length/2)];});
  colorPicking=false;canvas.classList.remove('marking');addColor('#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join(''),'画面取色');return;
 }
 if(marking&&video.paused){editPoint(canvasPoint(event));return;}

 if(collectingPoints&&video.paused&&last&&!batchRunning&&!segmentBusy){
  const rect=canvas.getBoundingClientRect();let x=(event.clientX-rect.left)/rect.width;const y=(event.clientY-rect.top)/rect.height;if($('mirror').checked)x=1-x;
  if(promptPoints.length<20&&!promptPoints.some(p=>Math.hypot(p[0]-x,p[1]-y)<.01))promptPoints.push([x,y]);
  $('segment-status').textContent=`已选 ${promptPoints.length} 个位置；可继续点击其他岩点，然后点击“分割所选点”。`;
  updateSegmentButtons();paintFrame();return;
 }

 if(segmenting&&video.paused&&last&&!segmentBusy){const rect=canvas.getBoundingClientRect();let x=(event.clientX-rect.left)/rect.width;const y=(event.clientY-rect.top)/rect.height;if($('mirror').checked)x=1-x;runSegment([x,y]);return;}
 if(video.paused){
  const p=canvasPoint(event),candidate=candidateAt(p);if(candidate){toggleCandidate(candidate.i);return;}
  marking=true;clearTimeout(colorTimer);colorRevision++;updateSegmentButtons();canvas.classList.add('marking');editPoint(p);
 }
};
function canvasPoint(event){const r=canvas.getBoundingClientRect();let x=(event.clientX-r.left)/r.width;if($('mirror').checked)x=1-x;return {x,y:(event.clientY-r.top)/r.height};}
function candidateAt(p){return segmentPolygons.map((poly,i)=>({i,poly,area:polygonInfo(poly).area_fraction})).filter(v=>contains(p,v.poly)).sort((a,b)=>a.area-b.area)[0];}
function toggleCandidate(i){segmentSelected.has(i)?segmentSelected.delete(i):segmentSelected.add(i);showCandidates();paintFrame();}
function nextHoldId(){for(let id=1;id<=100;id++)if(!holds.some(h=>h.id===id))return id;}
function rememberHolds(){holdUndo.push(holds.map(h=>({...h})));if(holdUndo.length>100)holdUndo.shift();}
$('undo-hold').onclick=()=>{if(holdUndo.length)holds=holdUndo.pop();syncHolds();paintFrame();};
$('clear-holds').onclick=()=>{rememberHolds();holds=[];syncHolds();paintFrame();};
$('mirror').onchange=paintFrame;

function sameRegion(a,b){
 const x=polygonInfo(a),y=polygonInfo(b),u=x.bbox,v=y.bbox;
 const overlap=Math.max(0,Math.min(u[2],v[2])-Math.max(u[0],v[0]))*Math.max(0,Math.min(u[3],v[3])-Math.max(u[1],v[1]));
 const union=(u[2]-u[0])*(u[3]-u[1])+(v[2]-v[0])*(v[3]-v[1])-overlap;
 return union>0&&overlap/union>.9&&Math.min(x.area_fraction,y.area_fraction)/Math.max(x.area_fraction,y.area_fraction)>.9;
}
function updateSegmentButtons(){
 const editable=!!last&&backdrop.width>1&&!segmentBusy&&!batchRunning;
 const usable=editable&&!!$('segment-model').value;
 $('color-pick').disabled=!editable;$('color-scan').disabled=!editable||!selectedColors.size;
 $('color-pick').setAttribute('aria-pressed',String(colorPicking));$('mark-holds').setAttribute('aria-pressed',String(marking));$('mark-holds').textContent=marking?'完成手动修正':'手动补点 / 删点';

 $('segment-multi').disabled=!usable;$('segment-run').disabled=!usable||!promptPoints.length;
 $('segment-run').textContent=`分割所选 ${promptPoints.length} 点`;$('segment-undo').disabled=!usable||!promptPoints.length;
 $('segment-select-all').disabled=!editable||!segmentPolygons.length;$('segment-select-none').disabled=!editable||!segmentSelected.size;
 $('segment-selection-count').textContent=`已选 ${segmentSelected.size} / ${segmentPolygons.length} 个候选`;
 $('holds-play').disabled=!active||!$('fixed-camera').checked||segmentBusy||batchRunning||promptPoints.length>0||(!holds.length&&!segmentSelected.size);
 $('holds-play').textContent=segmentSelected.size?`确认 ${segmentSelected.size} 个候选并播放监测`:'完成标记并播放监测';
 $('undo-hold').disabled=!holdUndo.length||batchRunning||segmentBusy;
 $('mark-holds').disabled=!editable;
 $('hold-interaction').textContent=!last?'先加载视频，画面出现后即可标记':segmentBusy||batchRunning?'正在处理候选，请稍候':colorPicking?'取色模式：点击岩点的颜色区域':collectingPoints?'SAM 批量模式：点击多个目标位置':segmenting?'SAM 模式：点击要分割的目标':!active?'当前为停止画面：仍可点击标记并导出':!$('fixed-camera').checked?'可直接点击画面暂停并标记；保留标记播放时再勾选固定机位':'点击画面即可暂停、选岩点；蓝色候选点一下取消或恢复';

 $('segment-click').disabled=!usable;$('segment-all').disabled=!usable||$('segment-model').value!=='fastsam-s';
 $('segment-accept').disabled=!editable||!video.paused||!segmentSelected.size;
 $('segment-export').disabled=!segmentMeta&&!holds.some(h=>h.polygon);
}
function clearSegments(){
 clearTimeout(colorTimer);colorRevision++;colorPicking=false;
 $('color-status').textContent='选色可重新生成候选；播放期间不运行颜色识别。';
 batchVersion++;batchRunning=false;collectingPoints=false;promptPoints=[];
 segmentVersion++;segmenting=false;segmentPolygons=[];segmentMeta=null;candidateInfo.clear();segmentSelected.clear();$('segment-candidates').replaceChildren();canvas.classList.remove('marking');
 $('segment-accept').disabled=true;if(last)last.segmentation=null;
 $('segment-status').textContent='候选已清除；可重新选颜色找点，或用手动修正补点。';
 updateSegmentButtons();
}
$('segment-model').onchange=()=>{segmentVersion++;batchVersion++;batchRunning=false;collectingPoints=false;promptPoints=[];segmenting=false;colorPicking=false;updateSegmentButtons();paintFrame();};
$('segment-click').onclick=()=>{if(!last)return;pauseForMarking();colorPicking=false;collectingPoints=false;promptPoints=[];marking=false;segmenting=true;updateSegmentButtons();canvas.classList.add('marking');$('segment-status').textContent='点击画面中的目标；本机计算期间请等待。';canvas.scrollIntoView({block:'center'});};
$('segment-multi').onclick=()=>{if(!last)return;pauseForMarking();colorPicking=false;segmenting=false;marking=false;collectingPoints=true;canvas.classList.add('marking');$('segment-status').textContent='连续点击多个不同岩点；黄色编号是待分割位置，选完后点击“分割所选点”。';updateSegmentButtons();canvas.scrollIntoView({block:'center'});};
$('segment-undo').onclick=()=>{promptPoints.pop();updateSegmentButtons();paintFrame();};
$('segment-select-all').onclick=()=>{segmentSelected=new Set(segmentPolygons.map((_,i)=>i));showCandidates();paintFrame();};
$('segment-select-none').onclick=()=>{segmentSelected.clear();showCandidates();paintFrame();};
$('segment-run').onclick=async()=>{
 if(!promptPoints.length||segmentBusy||batchRunning)return;
 const points=promptPoints.slice(),token=++batchVersion,sourceSession=session;batchRunning=true;collectingPoints=false;let failed=0;
 updateSegmentButtons();
 for(let i=0;i<points.length;i++){
  if(token!==batchVersion||sourceSession!==session||!video.paused)break;
  $('segment-status').textContent=`批量分割 ${i+1} / ${points.length}，请等待…`;
  if(!await runSegment(points[i],true))failed++;
 }
 if(token!==batchVersion||sourceSession!==session)return;
 batchRunning=false;promptPoints=[];canvas.classList.remove('marking');showCandidates();paintFrame();
 $('segment-status').textContent=`批量完成：${points.length} 个选点，${segmentPolygons.length} 个候选，已选 ${segmentSelected.size} 个。${failed?`${failed} 个位置未返回可用结果；可补点重试。`:''}检查轮廓后可直接确认并播放监测。`;
};
$('segment-all').onclick=()=>{collectingPoints=false;promptPoints=[];return runSegment(null);};
$('segment-clear').onclick=()=>{clearSegments();paintFrame();};
async function runSegment(point,append=!!point){
 if(!last||segmentBusy)return;
 pauseForMarking();segmenting=false;marking=false;canvas.classList.remove('marking');
 segmentBusy=true;const token=session,version=++segmentVersion,model=$('segment-model').value;
 if(!append){segmentPolygons=[];segmentMeta=null;candidateInfo.clear();segmentSelected.clear();$('segment-candidates').replaceChildren();last.segmentation=null;}updateSegmentButtons();
 if(!batchRunning)$('segment-status').textContent='正在本机分割，首次加载可能较慢…';
 try{
  // Wait for the single outstanding pose request before occupying the shared inference engine.
  while(busy&&token===session)await new Promise(r=>setTimeout(r,50));
  if(token!==session||version!==segmentVersion||!video.paused)return;
  const body=await backdrop.convertToBlob({type:'image/jpeg',quality:.95});
  const query=point?`?x=${point[0]}&y=${point[1]}`:'';
  const response=await fetch(`/api/models/${encodeURIComponent(model)}/infer${query}`,{method:'POST',body,signal:AbortSignal.timeout(120000)});
  const result=await response.json();if(!response.ok)throw new Error(result.detail||'分割失败');
  if(token!==session||version!==segmentVersion||!video.paused)return;
  const incoming=result.polygons.filter(p=>p.length>=3&&polygonInfo(p).area_fraction>1e-8);
  ingestCandidates({...result,point,polygons:incoming});
  $('segment-status').textContent=`${segmentPolygons.length} 个候选 · ${pretty(result.inference_ms)} ms · ${result.runtime}。`+(segmentPolygons.length?'请勾选并检查边界，确认后才能加入岩点标记。':'未找到目标；可换一个点击位置或切换模型。');
  // Point prompts select only the smallest returned region containing that point.
  if(point){const hit=segmentPolygons.map((p,i)=>({i,p,area:polygonInfo(p).area_fraction})).filter(v=>contains({x:point[0],y:point[1]},v.p)).sort((a,b)=>a.area-b.area)[0];if(hit)segmentSelected.add(hit.i);}
  showCandidates();paintFrame();return incoming.length>0;
 }catch(e){if(token===session&&version===segmentVersion)$('segment-status').textContent=`分割失败：${e.message}`;}
 finally{segmentBusy=false;updateSegmentButtons();}
}
function syncHolds(){
 $('hold-count').textContent=`${holds.length} 个标记`;$('clear-holds').disabled=!holds.length;
 if(segmentMeta)segmentMeta.confirmed_hold_ids=(segmentMeta.confirmed_hold_ids||[]).filter(id=>holds.some(h=>h.id===id));
 if(last){last.holds=holds.map(h=>({...h}));last.proximity=holdProximity(last.landmarks,holds,last.climbing,last.width,last.height,$('fixed-camera').checked);showClimbing(last);}
 updateSegmentButtons();
}
function showCandidates(){
 $('segment-candidates').replaceChildren(...segmentPolygons.map((p,i)=>{
  const info=polygonInfo(p),label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
  input.type='checkbox';input.checked=segmentSelected.has(i);input.setAttribute('aria-label',`候选 ${i+1}`);
  text.textContent=`${candidateInfo.get(p)?.source==='color-hsv'?'颜色候选':'候选'} ${i+1} · ${(info.area_fraction*100).toFixed(2)}% 画面 · ${p.length} 轮廓点`;
  input.onchange=()=>{input.checked?segmentSelected.add(i):segmentSelected.delete(i);showCandidates();paintFrame();};label.append(input,text);return label;
 }));
 if(segmentMeta)segmentMeta.selected_indices=[...segmentSelected].map(i=>segmentMeta.polygons.indexOf(segmentPolygons[i]));updateSegmentButtons();
}
function acceptSelected(){
 if(!segmentMeta||!video.paused)return;
 const accepted=[];if(segmentSelected.size)rememberHolds();
 for(const i of segmentSelected){if(holds.length>=100)break;const p=segmentPolygons[i],info=polygonInfo(p);holds.push({id:nextHoldId(),...info.center,visibility:1,...(candidateInfo.get(p)||{source:segmentMeta.model}),polygon:p,bbox:info.bbox,area_fraction:info.area_fraction});accepted.push(i);}
 segmentMeta.confirmed_hold_ids=[...(segmentMeta.confirmed_hold_ids||[]),...(accepted.length?holds.slice(-accepted.length).map(h=>h.id):[])];segmentMeta.confirmed=segmentMeta.confirmed_hold_ids.length>0;
 segmentPolygons=segmentPolygons.filter((p,i)=>!accepted.includes(i));segmentSelected.clear();showCandidates();syncHolds();
 $('segment-status').textContent=`已确认 ${accepted.length} 个岩点，绿色轮廓已保留。可继续选择其他候选，或播放后观察姿态与轮廓的二维邻近。`;paintFrame();
}
$('segment-accept').onclick=acceptSelected;
$('holds-play').onclick=async()=>{if(segmentBusy||batchRunning||promptPoints.length)return;if(segmentSelected.size)acceptSelected();if(holds.length)await resumeTracking();};
$('segment-export').onclick=()=>download(JSON.stringify({schema:'climbcue.segmentation.v1',source,frame:last?.frame,video_seconds:last?.video_seconds,width:last?.width,height:last?.height,coordinates:'normalized original image; static camera only; polygons approximate masks without holes; not grasp/contact positions',segmentation:segmentMeta,holds:holds.filter(h=>h.polygon)},null,2),'climbcue-segmentation.json','application/json');

function ingestCandidates(result,{replaceColor=false,selectAll=false}={}){
 const previouslySelected=new Set([...segmentSelected].map(i=>segmentPolygons[i]));
 if(replaceColor){for(const p of segmentPolygons)if(candidateInfo.get(p)?.source==='color-hsv')candidateInfo.delete(p);segmentPolygons=segmentPolygons.filter(p=>candidateInfo.has(p));}
 const added=[];
 for(const p of result.polygons){
  if(p.length<3||polygonInfo(p).area_fraction<=1e-8||segmentPolygons.length>=100)continue;
  if(segmentPolygons.some(old=>sameRegion(old,p))||holds.some(h=>h.polygon&&sameRegion(h.polygon,p)))continue;
  segmentPolygons.push(p);candidateInfo.set(p,{source:result.model,...(result.colors?{colors:result.colors}:{} )});added.push(p);
 }
 segmentSelected=new Set(segmentPolygons.map((p,i)=>previouslySelected.has(p)||(selectAll&&added.includes(p))?i:-1).filter(i=>i>=0));
 const previousRequests=segmentMeta?.requests||[];
 segmentMeta={...result,model:new Set(segmentPolygons.map(p=>candidateInfo.get(p)?.source)).size>1?'mixed':result.model,polygons:segmentPolygons.slice(),requests:[...previousRequests,{model:result.model,point:result.point??null,colors:result.colors,inference_ms:result.inference_ms,candidates:result.polygons.length}].slice(-100),video_seconds:last.video_seconds,confirmed:false};
 last.segmentation=segmentMeta;
}
const PRESET_COLORS=[['红色','#d52e37'],['绿色','#23964c'],['蓝色','#2583c5'],['黄色','#edce42'],['橙色','#e88428'],['紫色','#a05eb7'],['白色','#ececeb'],['黑色','#292b2c']];
for(const [name,color] of PRESET_COLORS){const b=document.createElement('button');b.className='color-swatch';b.dataset.color=color;b.setAttribute('aria-label',`选择${name}岩点`);b.setAttribute('aria-pressed','false');b.style.setProperty('--swatch',color);const dot=document.createElement('i');b.append(dot,document.createTextNode(name));b.onclick=()=>{if(selectedColors.has(color)){selectedColors.delete(color);renderColors();scheduleColorScan();}else addColor(color,name);};$('color-presets').append(b);}
function renderColors(){
 for(const b of $('color-presets').children)b.setAttribute('aria-pressed',String(selectedColors.has(b.dataset.color)));
 $('color-selected').replaceChildren(...[...selectedColors].map(([color,name])=>{const b=document.createElement('button');b.className='color-swatch';b.style.setProperty('--swatch',color);b.setAttribute('aria-label',`移除${name} ${color}`);const dot=document.createElement('i');b.append(dot,document.createTextNode(`${name} ×`));b.onclick=()=>{selectedColors.delete(color);renderColors();scheduleColorScan();};return b;}));updateSegmentButtons();
}
function addColor(color,name){if(selectedColors.size>=8&&!selectedColors.has(color)){$('color-status').textContent='最多同时选 8 种颜色，请先移除一种。';updateSegmentButtons();return;}selectedColors.set(color,name);$('color-custom').value=color;renderColors();scheduleColorScan();}
function scheduleColorScan(){
 const revision=++colorRevision;clearTimeout(colorTimer);
 if(!last){$('color-status').textContent='颜色已选好；加载视频后点击“按颜色找岩点”。';return;}
 const run=()=>{if(revision!==colorRevision)return;if(segmentBusy||batchRunning){colorTimer=setTimeout(run,150);return;}scanColors(revision);};colorTimer=setTimeout(run,250);
}
async function scanColors(revision){
 if(!last||revision!==colorRevision)return;
 if(!selectedColors.size){ingestCandidates({model:'color-hsv',polygons:[],colors:[],inference_ms:0},{replaceColor:true});showCandidates();paintFrame();$('color-status').textContent='颜色已取消，手动标记和已确认岩点保留。';return;}
 pauseForMarking();marking=false;segmenting=false;collectingPoints=false;promptPoints=[];colorPicking=false;canvas.classList.remove('marking');
 segmentBusy=true;const token=session,version=++segmentVersion,colors=[...selectedColors.keys()];updateSegmentButtons();$('color-status').textContent='正在按颜色查找整帧候选…';
 try{
  while(busy&&token===session)await new Promise(r=>setTimeout(r,40));
  if(token!==session||version!==segmentVersion||revision!==colorRevision||!video.paused)return;
  const body=await backdrop.convertToBlob({type:'image/jpeg',quality:.95});
  const query=new URLSearchParams({colors:colors.map(c=>c.slice(1)).join(','),tolerance:$('color-tolerance').value,min_area:String(Number($('color-min-area').value)/100)});
  const response=await fetch('/api/holds/color?'+query,{method:'POST',body,signal:AbortSignal.timeout(15000)}),result=await response.json();
  if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'颜色参数或图像无效');
  if(token!==session||version!==segmentVersion||revision!==colorRevision||!video.paused)return;
  ingestCandidates(result,{replaceColor:true,selectAll:true});showCandidates();paintFrame();
  $('color-status').textContent=`找到 ${result.polygons.length} 个同色候选 · ${Math.round(result.inference_ms)} ms。${result.truncated?'已截取前 100 个；建议缩小颜色范围。':''}检查蓝色区域；误选点一下取消，漏选用手动补点。`;
  $('segment-status').textContent='颜色候选已预选，仍需检查并确认。已确认岩点和手动补点不会被重新扫描覆盖。';
 }catch(e){if(token===session&&version===segmentVersion&&revision===colorRevision)$('color-status').textContent=`颜色识别失败：${e.message}`;}
 finally{segmentBusy=false;updateSegmentButtons();}
}
$('color-pick').onclick=()=>{if(!last)return;pauseForMarking();marking=false;segmenting=false;collectingPoints=false;promptPoints=[];colorPicking=!colorPicking;canvas.classList.toggle('marking',colorPicking);$('color-status').textContent=colorPicking?'点一个岩点的颜色区域，即可查找画面中的同色候选；取色来自原始画面。':'已退出取色。';updateSegmentButtons();canvas.scrollIntoView({block:'center'});};
$('color-scan').onclick=scheduleColorScan;
$('color-custom').onchange=()=>addColor($('color-custom').value,'自选色');
for(const id of ['color-tolerance','color-min-area'])$(id).oninput=()=>{$(id+'-value').textContent=$(id).value+(id==='color-min-area'?'%':'');scheduleColorScan();};
renderColors();

try{
 const response=await fetch('/api/models');if(!response.ok)throw new Error('本机模型清单不可用');
 modelCatalog=(await response.json()).models;
 for(const m of modelCatalog){const option=document.createElement('option');option.value=m.id;option.textContent=m.label+(m.available?'':' · 未就绪');option.disabled=!m.available;$(m.kind==='pose'?'pose-model':'segment-model').append(option);}
 $('segment-model').value=modelCatalog.find(m=>m.id==='mobilesam'&&m.available)?.id||'';updateSegmentButtons();
 let report=null;try{const r=await fetch('/static/model-benchmark.json');if(r.ok)report=await r.json();}catch{}
 const box=$('model-results');box.replaceChildren();
 try{const r=await fetch('/static/browser-model-benchmark.json');if(r.ok){const b=await r.json();for(const id of ['lite','full','heavy']){const p=document.createElement('p');const rr=b.runs.filter(x=>x.model===id);p.textContent=`MediaPipe ${id.toUpperCase()} · 浏览器 CPU/WASM · 本机 ${rr.map(x=>x.fps.toFixed(1)+' FPS').join(' / ')}`;box.append(p);}}}catch{}
 for(const m of modelCatalog){const p=document.createElement('p');const runs=report?.runs?.filter(r=>r.model===m.id&&r.ok)||[];p.textContent=`${m.label}：${m.available?'权重已就绪':m.reason} · ${runs[0]?.runtime||m.runtime}`+(runs.length?` · 本机推理中位数 ${runs.map(r=>Math.round(r.p50_ms)+' ms').join(' / ')}`:' · 尚无基准报告');box.append(p);}
 const p=document.createElement('p');p.textContent='姿态每帧选择最大可见人体，多人可能换人。分割模型只按点击/请求运行；模型分数不可横向当作准确率。';box.append(p);
}catch(e){$('model-results').textContent=e.message;}
// Capture synchronously from the last rendered inference frame, never the advancing video.
// This canvas is unmirrored even when the on-screen preview is mirrored.
function captureCoachImages(){
 if(!last||backdrop.width<16)throw new Error('尚无同步画面，请等待姿态识别');
 const image=document.createElement('canvas');image.width=backdrop.width;image.height=backdrop.height;
 const c=image.getContext('2d');c.drawImage(backdrop,0,0);
 const raw=image.toDataURL('image/jpeg',.8);
 c.lineWidth=2;c.font='bold 16px sans-serif';
 for(const h of holds){
  const x=h.x*image.width,y=h.y*image.height;
  if(h.polygon?.length>=3){
   c.beginPath();h.polygon.forEach(([px,py],i)=>{i?c.lineTo(px*image.width,py*image.height):c.moveTo(px*image.width,py*image.height);});c.closePath();
   c.strokeStyle='#00ffff';c.fillStyle='rgba(0,255,255,.12)';c.fill();c.stroke();
  }
  c.strokeStyle='#00ffff';c.beginPath();c.arc(x,y,7,0,Math.PI*2);c.stroke();
  const label='#'+h.id,tx=Math.min(image.width-c.measureText(label).width-4,x+9),ty=Math.max(18,y-9);
  c.strokeStyle='#000';c.lineWidth=4;c.strokeText(label,tx,ty);c.fillStyle='#fff';c.fillText(label,tx,ty);c.lineWidth=2;
 }
 return {snapshot_id:`${session}:${last.model}:${last.frame}`,width:image.width,height:image.height,raw,annotated:image.toDataURL('image/jpeg',.85)};
}
initCoach(()=>({snapshot:last,source,session,active,paused:video.paused,videoTime:video.currentTime,historyFrames:frame,fixedCamera:$('fixed-camera').checked,
 holds:holds.map(h=>({id:h.id,x:h.x,y:h.y,source:h.source||'manual',colors:h.colors||[],polygon:h.polygon||null})),captureImages:captureCoachImages,
 selectedCandidates:segmentSelected.size,holdProcessing:segmentBusy||batchRunning,
 freezeForCoach:()=>{pauseForMarking();if(segmentSelected.size)acceptSelected();$('play').textContent='播放';}}));
