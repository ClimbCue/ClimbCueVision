import {initCoachVisual} from './coach-visual.js?v=hold-visible-20261017';
const $=id=>document.getElementById(id);
const ENDPOINTS={leftHand:15,rightHand:16,leftFoot:31,rightFoot:32};
const LABELS={leftHand:'左手',rightHand:'右手',leftFoot:'左脚',rightFoot:'右脚'};
export function initCoach(getState){
 let inFlight=false,generation=0,result=null,packet=null,contextKey='',autoAt=0,confirmed={};
 const mode=$('coach-mode'),hud=$('coach-cue'),stateLabel=$('coach-state');
 const visual=initCoachVisual();let requestStarted=0,modeTouched=false;
 const plain=text=>text.replaceAll('allowed_moves','可用的换点候选').replaceAll('confirmed_supports','已确认支点').replaceAll('input_quality','观测质量').replaceAll('center_proxy','身体中心投影');
 function status(label,state){$('coach-result-status').textContent=label;$('coach-results').dataset.state=state;}
 function invalidate(message='等待新的观测',state='idle'){
  generation++;result=null;packet=null;$('coach-export').disabled=true;hud.textContent='先观察，再行动';stateLabel.textContent=message;
  $('coach-origin').textContent='尚无有效分析结果';$('coach-meta').textContent='简略版与详细版由同一动作生成；结果出现后可对照快照检查。';
  visual.clear();$('coach-response').textContent='尚无本次分析结果';$('coach-duration').textContent='—';$('coach-model-label').textContent='—';$('coach-execution').textContent='分析后显示这一动作的执行条件。';$('coach-action-type').textContent='等待分析';status(state==='error'?'分析失败':state==='stale'?'结果已失效':'等待分析',state);
  $('coach-detail-instruction').textContent='暂无有效指令';$('coach-reason').textContent=message;
  $('coach-evidence').replaceChildren();$('coach-cautions').replaceChildren();$('coach-citations').replaceChildren();
 }
 const pointMoved=(a,b)=>!a||!b||a.visibility<.5||b.visibility<.5||Math.hypot(a.x-b.x,a.y-b.y)>.035;
 function changed(a,b){return [11,12,15,16,23,24,27,28].some(i=>(a[i]||b[i])&&pointMoved(a[i],b[i]));}
 function isStale(saved,s){
  if(!s.active||!s.snapshot||s.session!==saved.session)return true;
  if(Math.abs(s.videoTime-s.snapshot.video_seconds)>.5||s.videoTime<saved.videoSeconds-.1)return true;
  if(saved.paused&&(!s.paused||s.snapshot.frame!==saved.frame))return true;
  if(!saved.paused&&(performance.now()-saved.at>5000||changed(saved.points,s.snapshot.landmarks)))return true;
  return false;
 }
 function updateSupports(s){
  const key=JSON.stringify([s.session,s.fixedCamera,s.holds]);
  if(key===contextKey)return;
  contextKey=key;confirmed={};invalidate('姿态输入或岩点已更新，请重新分析');
  for(const limb of Object.keys(ENDPOINTS)){
   const select=$('support-'+limb);select.replaceChildren(new Option('未确认',''));
   for(const h of s.holds)select.add(new Option('#'+h.id,String(h.id)));
  }
 }
 for(const limb of Object.keys(ENDPOINTS))$('support-'+limb).onchange=()=>{
  const s=getState();confirmed[limb]={at:performance.now(),id:Number($('support-'+limb).value),point:s.snapshot?.landmarks[ENDPOINTS[limb]]};invalidate('支点确认已更新，请重新分析');
 };
 mode.onchange=()=>{modeTouched=true;invalidate('指导模式已切换');};$('coach-goal').oninput=()=>invalidate('目标已更改');
 try{$('coach-custom-prompt').value=localStorage.getItem('climbcue.coach.preferences')||'';}catch{}
 $('coach-custom-prompt').oninput=()=>{invalidate('提示词已更改');try{localStorage.setItem('climbcue.coach.preferences',$('coach-custom-prompt').value);}catch{}};
 function show(data,saved){
  result={data,saved};const preview=data.mode==='preview';
  $('coach-origin').textContent=preview?'本地策略预览 · 未调用大模型':`大模型 · ${data.model}`;
  status(preview?'本地预览完成':'大模型分析完成','ready');$('coach-duration').textContent=(data.elapsed_ms/1000).toFixed(2)+' 秒';$('coach-model-label').textContent=preview?'本地规则预览':data.model;
  $('coach-action-type').textContent=({inspect_hold:'观察目标岩点',confirm_support:'先确认支撑',test_move:'单肢试探',wait_observation:'等待清晰观测'})[data.action.action];
  visual.show(saved,data.action);$('coach-response').textContent=JSON.stringify(data,null,2);
  hud.textContent=data.glasses.text;stateLabel.textContent=saved.paused?'暂停帧预览 · 不实时下发':'有效观察 · 5 秒内失效';
  $('coach-detail-instruction').textContent=data.web.instruction;$('coach-reason').textContent=plain(data.web.reason);
  $('coach-execution').textContent=data.web.execution_note;
  $('coach-evidence').replaceChildren(...data.web.observations.map(o=>{const li=document.createElement('li');li.textContent=o.text;return li;}));
  $('coach-cautions').replaceChildren(...(data.web.cautions.length?data.web.cautions:['模型没有补充其他限制；先核实画面与现场是否一致。']).map(t=>{const p=document.createElement('p');p.textContent=plain(t);return p;}));
  $('coach-citations').replaceChildren(...data.web.citations.map(c=>{const p=document.createElement('p');p.textContent=`[${c.citation_id}] ${c.title}`;return p;}));
  if(!data.web.citations.length)$('coach-citations').textContent='本次未引用知识资料。';
  $('coach-meta').textContent=`第 ${data.frame} 帧 · ${data.video_seconds.toFixed(2)} 秒 · ${data.input_summary.images||0} 张图片 · ${data.input_summary.holds} 个岩点（${data.input_summary.segmented_holds||0} 个有轮廓）· 两版共用同一动作`;
  packet={schema:'climbcue.glasses.v1',sequence:saved.frame,snapshot_id:data.snapshot_id,generated_at:new Date().toISOString(),preview_only:true,hardware_connected:false,model_executed:data.model_executed,mode:data.mode,action:data.action,display:data.glasses,source_frame:{time_seconds:data.video_seconds,width:saved.width,height:saved.height}};
  $('coach-export').disabled=false;
  if(saved.manual)$('coach-results').scrollIntoView({block:'start',behavior:'smooth'});
 }
 async function analyze(freeze=false){
  let s=getState();if(inFlight||!s.active||!s.snapshot||s.holdProcessing)return;
  if(freeze){s.freezeForCoach();$('coach-auto').checked=false;s=getState();}
  updateSupports(s);
  if(Math.abs(s.videoTime-s.snapshot.video_seconds)>.5){invalidate('进度已改变，播放后等待新姿态再分析');return;}
  inFlight=true;requestStarted=performance.now();$('coach-run').disabled=true;const request=++generation;
  status('正在分析此帧…','loading');$('coach-duration').textContent='0.0 秒';$('coach-model-label').textContent=mode.value==='llm'?'云端模型':'本地预览';$('coach-response').textContent='等待模型返回…';$('coach-action-type').textContent='等待本次结果';$('coach-execution').textContent='等待分析完成。';
  stateLabel.textContent=mode.value==='llm'?'正在生成，暂不行动':'生成本地策略预览';hud.textContent='等待本次分析';
  result=null;packet=null;$('coach-export').disabled=true;
  $('coach-detail-instruction').textContent='正在分析当前观测';$('coach-reason').textContent='等待本次结果，上一条指令已撤回。';
  $('coach-evidence').replaceChildren();$('coach-cautions').replaceChildren();$('coach-citations').replaceChildren();
  const f=s.snapshot,saved={at:performance.now(),session:s.session,paused:s.paused,frame:f.frame,videoSeconds:f.video_seconds,points:f.landmarks,width:f.width,height:f.height,holds:s.holds,manual:freeze};
  const supports={};
  for(const [limb,v] of Object.entries(confirmed))if(v.id&&(s.paused||performance.now()-v.at<15000)&&!pointMoved(v.point,f.landmarks[ENDPOINTS[limb]]))supports[limb]=v.id;
  const body={mode:mode.value,snapshot_id:`${s.session}:${f.model}:${f.frame}`,frame:f.frame,video_seconds:f.video_seconds,width:f.width,height:f.height,model:f.model,detected_people:f.detected_people??1,
   landmarks:f.landmarks.map(p=>p?{x:p.x,y:p.y,visibility:p.visibility??0}:null),fixed_camera:s.fixedCamera,holds:s.holds,confirmed_supports:supports,
   user_goal:$('coach-goal').value||'寻找下一步可用岩点',custom_prompt:$('coach-custom-prompt').value,movement:f.motion?.movement||'unknown',history_frames:Math.min(s.historyFrames,1800)};
  try{
   const images=s.captureImages();saved.rawImage=images.raw;visual.show(saved);
   if(body.mode==='llm')body.frame_images=images;
   const response=await fetch('/api/coach/next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
   const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'输入未通过校验');
   if(request!==generation)return;
   if(data.snapshot_id!==body.snapshot_id||isStale(saved,getState())){invalidate('观测已变化或结果过期，未显示旧指令');return;}
   show(data,saved);
  }catch(e){if(e.message.includes('实名认证'))$('coach-auto').checked=false;if(request===generation)invalidate(`未生成指令：${e.message}`,'error');}
  finally{inFlight=false;$('coach-run').disabled=!getState().active;autoAt=performance.now();}
 }
 $('coach-run').onclick=()=>analyze(true);
 $('coach-auto').onchange=()=>{autoAt=0;};
 $('coach-export').onclick=()=>{if(!packet)return;const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='climbcue-glasses-command.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const timer=setInterval(()=>{
  const s=getState();updateSupports(s);$('coach-run').disabled=inFlight||!s.active||!s.snapshot||s.holdProcessing;
  $('coach-run').textContent=s.holdProcessing?'等待岩点处理完成':s.selectedCandidates?`确认 ${s.selectedCandidates} 个所选候选并分析`:'截取瞬间并分析';
  $('coach-hold-input').textContent=`岩点输入：${s.holds.length} 个已确认${s.selectedCandidates?`，${s.selectedCandidates} 个已选候选待确认（点击分析时加入）`:s.holds.length?'':'；请先选颜色找点或点击画面标记'}`;
  if(inFlight&&$('coach-results').dataset.state==='loading')$('coach-duration').textContent=((performance.now()-requestStarted)/1000).toFixed(1)+' 秒';
  if(result&&isStale(result.saved,s))invalidate('上一条指令已失效，请重新观察','stale');
  if($('coach-auto').checked&&!s.paused&&s.active&&!inFlight&&performance.now()-autoAt>=6000){autoAt=performance.now();analyze();}
 },250);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 async function refreshConfig(selectDefault=false){return fetch('/api/coach/config').then(r=>r.json()).then(c=>{
  $('coach-config').textContent=c.configured?`已配置 ${c.model}；点击分析会暂停画面，将同一瞬间的图片、姿态、已确认岩点轮廓一起发送，仅分析这一帧。`:`${c.model} 待配置：在项目 .env 填写 CLIMBCUE_COACH_API_KEY，保存后点“测试模型连接”。`;
  const option=mode.querySelector('[value="llm"]');option.disabled=!c.configured;
  if(c.configured&&selectDefault&&!modeTouched)mode.value='llm';
  if(!c.configured&&mode.value==='llm'){mode.value='preview';invalidate('大模型配置不可用');}
  return c;
 }).catch(()=>{$('coach-config').textContent='指导服务连接失败，请检查本地服务。';});}
 refreshConfig(true);
 $('coach-test').onclick=async()=>{
  const button=$('coach-test'),label=$('coach-test-result');button.disabled=true;
  label.textContent='测试中：文本连接＋图片识别，最多两次模型请求…';
  try{
   await refreshConfig();
   const response=await fetch('/api/coach/test',{method:'POST',signal:AbortSignal.timeout(100000)}),data=await response.json();
   if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'测试失败');
   label.textContent=data.checks.map(c=>`${c.kind==='text'?'文本':'图片'}：${c.passed?'通过':'未通过'} · ${Math.round(c.elapsed_ms)} ms · ${c.error||c.answer||''}`).join('；');
   if(data.checks.some(c=>c.error?.includes('实名认证')))$('coach-auto').checked=false;
   if(data.passed){mode.value='llm';invalidate('模型连接测试通过，请分析当前画面');}
  }catch(e){label.textContent=`测试未完成：${e.message}`;}
  finally{button.disabled=false;}
 };
 $('coach-prompt-details').addEventListener('toggle',async()=>{
  if(!$('coach-prompt-details').open||$('coach-prompt').value)return;
  try{const r=await fetch('/api/coach/prompt');if(!r.ok)throw Error();$('coach-prompt').value=(await r.json()).system_prompt;}
  catch{$('coach-prompt').value='提示词读取失败';}
 });
}
