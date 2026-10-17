const $=id=>document.getElementById(id);
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'请求字段无效，请检查输入。');return data;}
function link(url,text){const e=element('a',text);try{const u=new URL(url);if(['http:','https:'].includes(u.protocol)){e.href=u.href;e.target='_blank';e.rel='noopener noreferrer';}else e.textContent=url;}catch{e.textContent=url;}return e;}
function cardNode(card,citation,full=false){
  const e=element('article',null,full?'result':'library-item');
  if(card.media_type==='video')e.append(element('span','▷','video-icon'));
  const kind=card.status==='draft'?'待审核草稿':card.media_type==='video'?(card.content_level==='metadata'?'视频入口 · 未转录':'视频字幕'):card.category==='recovery'?'恢复与拉伸':'知识卡片';
  e.append(element('span',kind,'pill'),element('h3',card.title),element('p',card.text));
  if(full){const d=element('details');d.append(element('summary','适用条件与核对记录'),element('p',`适用：${card.applicability}`),element('p',`限制：${card.limitations}`),element('p',card.review_note),element('p',`使用权：${card.rights}`));e.append(d);}
  e.append(link(card.source,'查看原始来源 ↗'));
  if(card.category==='recovery'&&card.id.startsWith('recovery-')){const a=element('a','下载中文文档 ↓');a.href='/recovery-docs/'+encodeURIComponent(card.id.slice(9).replace(/-[^-]+$/,''))+'.md';a.download='';e.append(document.createTextNode('　'),a);}
  if(card.video_url){e.append(document.createTextNode('　'),link(card.video_url,'打开官方视频 ↗'));}
  if(full)e.append(element('code',citation));
  return e;
}
let library=[],libraryType='all';
function renderLibrary(){const filtered=library.filter(c=>libraryType==='draft'?c.status==='draft':c.eligible&&(libraryType==='all'||(libraryType==='recovery'?c.category==='recovery':c.media_type===libraryType)));$('library-count').textContent=`${filtered.length} 条资料`;$('library').replaceChildren(...filtered.map(c=>cardNode(c,c.citation_id)));if(!filtered.length)$('library').append(element('p','暂无此类资料','results-empty'));}
async function refresh(){const [stats,cards]=await Promise.all([api('/api/knowledge/stats'),api('/api/knowledge/cards?include_drafts=true')]);$('total').textContent=stats.total;$('eligible').textContent=stats.eligible;$('video-count').textContent=stats.videos;$('source-count').textContent=stats.sources;library=cards;renderLibrary();}
document.querySelectorAll('[data-library]').forEach(b=>b.onclick=()=>{libraryType=b.dataset.library;document.querySelectorAll('[data-library]').forEach(x=>x.classList.toggle('active',x===b));renderLibrary();});
document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.query;$('category-filter').value=b.dataset.category||'';$('media-filter').value='';$('query-form').requestSubmit();});
$('query-form').onsubmit=async event=>{
  event.preventDefault();const query=$('question').value.trim();if(!query)return;
  $('ask').disabled=true;$('query-status').classList.remove('error');$('query-status').textContent='正在检索本地资料…';$('answer').textContent='';$('results').replaceChildren();
  const mode=$('mode').value;
  try{const result=await api(`/api/knowledge/${mode==='search'?'search':'ask'}`,{query,limit:4,category:$('category-filter').value||null,media_type:$('media-filter').value||null,...(mode==='search'?{}:{mode})});
    $('answer').textContent=result.answer||'';
    $('query-status').textContent=`找到 ${result.hits.length} 条相关资料 · ${result.elapsed_ms} ms · ${result.model_executed?'大模型已执行，引用 ID 已校验':mode==='search'?'仅检索':'检索式摘要，未调用大模型'}`;
    $('results').replaceChildren(...result.hits.map(h=>{const e=cardNode(h.card,h.citation_id,true);e.append(element('p',`匹配词：${h.matched_terms.join(' / ')} · 检索分 ${h.score.toFixed(3)}（不是置信度）`,'caption'));return e;}));
    if(!result.hits.length)$('results').append(element('p','没有找到足够相关的资料。试试更具体的攀岩术语。','results-empty'));
  }catch(error){$('query-status').textContent=error.message;$('query-status').classList.add('error');}
  finally{$('ask').disabled=false;}
};
$('notes-file').onchange=async()=>{const f=$('notes-file').files[0];if(!f)return;if(f.size>800000){$('import-status').textContent='文件过大，请使用不超过 800 KB 的文本文件。';return;}try{$('note-text').value=await f.text();if(!$('note-title').value)$('note-title').value=f.name.replace(/\.[^.]+$/,'');}catch{$('import-status').textContent='读取文件失败，请重新选择。';}};
$('import-form').onsubmit=async event=>{event.preventDefault();$('import-submit').disabled=true;try{const result=await api('/api/knowledge/import',{title:$('note-title').value.trim(),source:$('note-source').value.trim(),rights:$('note-rights').value.trim(),text:$('note-text').value.trim(),video_url:$('note-video').value.trim()||null});$('import-status').textContent=`${result.message} 新增 ${result.imported} 条。文件：${result.file}`;await refresh();}catch(error){$('import-status').textContent=error.message;}finally{$('import-submit').disabled=false;}};
try{await refresh();const videos=await api('/api/videos');$('local-count').textContent=`${videos.length} 段`;for(const [i,v] of videos.entries()){const item=element('div');item.append(element('p',`测试视频 ${String(i+1).padStart(2,'0')} · ${(v.bytes/1024).toFixed(0)} KB`,'caption'));const video=element('video');video.src=v.url;video.controls=true;video.preload='none';video.playsInline=true;item.append(video);const a=element('a','到姿态页追踪 →');a.href='/pose';item.append(a);$('local-clips').append(item);}const health=await api('/api/health');if(!health.llm_configured)$('mode').options[1].textContent='大模型 RAG · 尚未配置';}catch(error){$('query-status').textContent=`加载失败：${error.message}`;$('query-status').classList.add('error');}
