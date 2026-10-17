"""Grounded next-step planner, one canonical action shared by HUD and web."""
import base64
import binascii
import io
import json
import math
from pathlib import Path
import re
import time
import uuid
from typing import Annotated, Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from PIL import Image, UnidentifiedImageError
from web.coach_settings import config, configured, is_joymaas

PROMPT_PATH=Path(__file__).resolve().parents[1]/'docs/prompts/climbing-coach-v1.md'
PROMPT_VERSION='climbing-coach-v2-vision'
LIMBS={'leftHand':(11,13,15),'rightHand':(12,14,16),'leftFoot':(23,25,31),'rightFoot':(24,26,32)}
LABELS={'leftHand':'左手','rightHand':'右手','leftFoot':'左脚','rightFoot':'右脚'}

class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)

class Point(Strict):
    x: float=Field(ge=-5,le=5)
    y: float=Field(ge=-5,le=5)
    visibility: float=Field(ge=0,le=10)

class Hold(Strict):
    id: int=Field(ge=1,le=100)
    x: float=Field(ge=0,le=1)
    y: float=Field(ge=0,le=1)
    source: str=Field(default='manual',max_length=80)
    colors: list[str]=Field(default_factory=list,max_length=8)
    polygon: list[tuple[Annotated[float,Field(ge=0,le=1)],Annotated[float,Field(ge=0,le=1)]]]|None=Field(default=None,min_length=3,max_length=256)

    @model_validator(mode='after')
    def valid_outline(self):
        if self.polygon:
            area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(self.polygon,self.polygon[1:]+self.polygon[:1])))/2
            if area<1e-8:raise ValueError('岩点轮廓面积为零')
        return self

class FrameImages(Strict):
    snapshot_id: str=Field(min_length=1,max_length=120)
    width: int=Field(ge=16,le=1280)
    height: int=Field(ge=16,le=1280)
    raw: str=Field(max_length=2_800_000)
    annotated: str|None=Field(default=None,max_length=2_800_000)

    @model_validator(mode='after')
    def valid_images(self):
        for url in (self.raw,self.annotated):
            if url is None:continue
            if not url.startswith('data:image/jpeg;base64,'):
                raise ValueError('指导图片必须是 JPEG data URL')
            try:
                data=base64.b64decode(url.split(',',1)[1],validate=True)
                if len(data)>2_000_000:raise ValueError('单张图片超过 2 MB')
                with Image.open(io.BytesIO(data)) as im:
                    if im.format!='JPEG' or im.size!=(self.width,self.height):
                        raise ValueError('图片尺寸或格式不匹配')
                    im.load()
            except (binascii.Error,UnidentifiedImageError,OSError,Image.DecompressionBombError):
                raise ValueError('无法解码指导图片') from None
        return self

class CoachInput(Strict):
    mode: Literal['preview','llm']='preview'
    snapshot_id: str=Field(min_length=1,max_length=120)
    frame: int=Field(ge=1)
    video_seconds: float=Field(ge=0)
    width: int=Field(ge=16,le=16384)
    height: int=Field(ge=16,le=16384)
    model: str=Field(max_length=80)
    landmarks: list[Point|None]=Field(max_length=33)
    fixed_camera: bool
    detected_people: int=Field(default=1,ge=0,le=100)
    holds: list[Hold]=Field(default_factory=list,max_length=100)
    confirmed_supports: dict[Literal['leftHand','rightHand','leftFoot','rightFoot'],int]=Field(default_factory=dict,max_length=4)
    user_goal: str=Field(default='寻找下一步可用岩点',max_length=200)
    movement: Literal['unknown','moving','low_motion','pause_candidate']='unknown'
    history_frames: int=Field(default=0,ge=0,le=1800)
    frame_images: FrameImages|None=None
    custom_prompt: str=Field(default='',max_length=3000)

    @model_validator(mode='after')
    def check_refs(self):
        if len(self.landmarks) not in (0,33):raise ValueError('需要 33 个语义槽位，缺失点用 null')
        ids={h.id for h in self.holds}
        if len(ids)!=len(self.holds):raise ValueError('岩点编号重复')
        if not set(self.confirmed_supports.values())<=ids:raise ValueError('支点必须引用已有岩点')
        if self.frame_images:
            images=self.frame_images
            if images.snapshot_id!=self.snapshot_id:raise ValueError('图片与姿态快照不一致')
            if abs(images.width/images.height-self.width/self.height)>.01:
                raise ValueError('图片和姿态画幅比例不一致')
        return self

class Plan(Strict):
    action: Literal['inspect_hold','confirm_support','test_move','wait_observation']
    limb: Literal['leftHand','rightHand','leftFoot','rightFoot']|None=None
    target_hold_id: int|None=None
    reason: str=Field(min_length=1,max_length=160)
    evidence_ids: list[str]=Field(min_length=1,max_length=6)
    cautions: list[str]=Field(default_factory=list,max_length=2)
    citations: list[str]=Field(default_factory=list,max_length=4)

    @model_validator(mode='after')
    def validate_text(self):
        if any(len(x)>80 for x in self.cautions):raise ValueError('限制说明过长')
        if re.search(r'跳跃|双手松开|同时松开|解开|挂片|绝对安全|保证安全|100%',self.reason+' '.join(self.cautions)):
            raise ValueError('输出包含不支持的动作或保证')
        return self

def reliable(p):
    return p is not None and p.visibility>=.5 and 0<=p.x<=1 and 0<=p.y<=1

def build_context(body: CoachInput, hits):
    points=body.landmarks or [None]*33
    def dist(a,b):return math.hypot((a.x-b.x)*body.width,(a.y-b.y)*body.height)
    items=[{'id':'quality','text':f'可靠语义点 {sum(map(reliable,points))}/33；检测人数 {body.detected_people}（单人模型不保证发现所有人）；模型 {body.model}；这些不是准确率。'},
           {'id':'camera','text':f'固定机位：{"已由用户确认" if body.fixed_camera else "尚未确认"}。'},
           {'id':'supports','text':'用户本次核对的支点：'+('、'.join(f'{LABELS[k]} #{v}' for k,v in body.confirmed_supports.items()) or '尚未确认')+'；未列出的支点不代表已支撑。'},
           {'id':'motion','text':f'短时状态：{dict(unknown="尚无连续观测",moving="正在移动",low_motion="位移较小",pause_candidate="停顿候选")[body.movement]}；已有 {body.history_frames} 帧。'}]
    ready=body.detected_people==1 and all(reliable(points[i]) for i in [11,12,23,24])
    for name,ids in LIMBS.items():
        vals=[points[i] for i in ids]
        if all(map(reliable,vals)):
            a,b,c=vals;u=((a.x-b.x)*body.width,(a.y-b.y)*body.height);v=((c.x-b.x)*body.width,(c.y-b.y)*body.height)
            norm=math.hypot(*u)*math.hypot(*v)
            if norm>1e-8:
                angle=math.degrees(math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/norm))))
                items.append({'id':name,'text':f'{LABELS[name]}末端投影 ({c.x:.3f},{c.y:.3f})；两段投影夹角 {angle:.1f}°，不是三维角度或受力。'})
    for hold in body.holds:items.append({'id':f'hold.{hold.id}','text':f'用户确认候选岩点 #{hold.id}，图像归一化坐标 ({hold.x:.3f},{hold.y:.3f})；来源 {hold.source}；'+(f'包含 {len(hold.polygon)} 点分割轮廓。' if hold.polygon else '仅标记点，没有分割轮廓。')})
    allowed=[]
    by_id={h.id:h for h in body.holds}
    torso=0
    if ready:
        shoulder=Point(x=(points[11].x+points[12].x)/2,y=(points[11].y+points[12].y)/2,visibility=1)
        hip=Point(x=(points[23].x+points[24].x)/2,y=(points[23].y+points[24].y)/2,visibility=1)
        torso=dist(shoulder,hip)
        items.append({'id':'center_proxy','text':f'肩髋几何中心 ({(shoulder.x+hip.x)/2:.3f},{(shoulder.y+hip.y)/2:.3f})，不是实测质量中心。'})
    support_valid={}
    for limb,ident in body.confirmed_supports.items():
        endpoint=points[LIMBS[limb][2]]
        if reliable(endpoint) and torso>10 and dist(endpoint,by_id[ident])<=.3*torso:support_valid[limb]=ident
    if ready and torso>10 and body.fixed_camera and body.history_frames>=10 and body.movement in ['low_motion','pause_candidate']:
        for limb,ids in LIMBS.items():
            if len([x for x in support_valid if x!=limb])<3:continue
            if not all(reliable(points[i]) for i in ids):continue
            a,b,c=[points[i] for i in ids];reach=dist(a,b)+dist(b,c)
            for hold in body.holds:
                if hold.id in body.confirmed_supports.values():continue
                if dist(a,hold)<=reach and dist(c,hold)>.1*torso:
                    allowed.append({'limb':limb,'target_hold_id':hold.id,'projection_only':True})
    return {'snapshot':{'id':body.snapshot_id,'frame':body.frame,'video_seconds':body.video_seconds},
            'user_goal':body.user_goal,'custom_prompt':body.custom_prompt,
            'pose':{'model':body.model,'width':body.width,'height':body.height,'landmarks':[p.model_dump() if p else None for p in points],
                    'coordinate_system':'normalized original image; unmirrored; x right, y down; left/right refer to subject'},
            'input_quality':{'core_visible':ready,'fixed_camera':body.fixed_camera,'movement':body.movement},
            'observation_items':items,'holds':[h.model_dump() for h in body.holds],
            'confirmed_supports':body.confirmed_supports,'allowed_moves':allowed,
            'evidence':[{'citation_id':h['citation_id'],'title':h['card']['title'],'text':h['card']['text'],'limitations':h['card']['limitations']} for h in hits]}

def validate_plan(plan: Plan, context):
    ids={h['id'] for h in context['holds']}
    if not set(plan.evidence_ids)<={o['id'] for o in context['observation_items']}:raise ValueError('无效观测引用')
    if not set(plan.citations)<={e['citation_id'] for e in context['evidence']}:raise ValueError('无效知识引用')
    if plan.action=='test_move':
        if not any(m['limb']==plan.limb and m['target_hold_id']==plan.target_hold_id for m in context['allowed_moves']):raise ValueError('动作不满足观测与支点条件')
    elif plan.action=='inspect_hold':
        if plan.target_hold_id not in ids or plan.limb is not None:raise ValueError('无效目标岩点')
        if not context['input_quality']['core_visible'] or not context['input_quality']['fixed_camera']:raise ValueError('机位或姿态未确认')
    elif plan.action=='confirm_support':
        if plan.target_hold_id is not None:raise ValueError('不得把确认提示写成换点')
    elif plan.target_hold_id is not None or plan.limb is not None:raise ValueError('等待动作不能包含换点')
    return plan

def preview_plan(context):
    q=context['input_quality']
    if not q['core_visible'] or not q['fixed_camera'] or q['movement']=='moving':
        return Plan(action='wait_observation',reason='姿态、机位或运动状态尚不足以规划换点，先获得稳定观测。',evidence_ids=['quality','camera','motion'],cautions=['当前是本地策略预览，没有调用大模型。'])
    if context['holds']:
        ident=context['holds'][0]['id']
        return Plan(action='inspect_hold',target_hold_id=ident,reason='展示已确认候选的观察提示；此预览不会自动决定换手、换脚或最佳路线。',evidence_ids=[f'hold.{ident}','supports'],cautions=['岩点可用性、深度及承重仍需现场核实。'])
    return Plan(action='confirm_support',reason='尚无用户确认的候选岩点，先核对当前支点并在画面标记岩点。',evidence_ids=['supports'],cautions=['二维姿态无法直接测量承重。'])

def present(plan,context,mode,model,elapsed_ms):
    limb=LABELS.get(plan.limb,'')
    cue={'inspect_hold':f'看 #{plan.target_hold_id}，确认下一点','confirm_support':f'先确认{limb+"支撑" if limb else "当前支点"}',
         'test_move':f'{limb}试探 #{plan.target_hold_id}','wait_observation':'先确认支点，等待识别'}[plan.action]
    assert len(cue)<=20
    evidence=[i for i in context['observation_items'] if i['id'] in plan.evidence_ids]
    target=next((h for h in context['holds'] if h['id']==plan.target_hold_id),None)
    return {'prompt_version':PROMPT_VERSION,'mode':mode,'model_executed':mode=='llm','model':model if mode=='llm' else None,
            'snapshot_id':context['snapshot']['id'],'frame':context['snapshot']['frame'],'video_seconds':context['snapshot']['video_seconds'],
            'elapsed_ms':round(elapsed_ms,1),'action':plan.model_dump(),
            'glasses':{'text':cue,'ttl_ms':5000,'priority':'observe' if plan.action!='test_move' else 'suggestion','target':target,'coordinate_system':'normalized source image, NOT glasses world anchor'},
            'web':{'instruction':cue,'reason':plan.reason,'observations':evidence,'cautions':plan.cautions,
                   'execution_note':'只有现场确认可达且其他支撑稳定时才试探；不稳时停止尝试，优先保持支撑。' if plan.action=='test_move' else '先完成这一条观察或确认，再刷新姿态规划下一步。',
                   'citations':[e for e in context['evidence'] if e['citation_id'] in plan.citations]},
            'input_summary':{'holds':len(context['holds']),'segmented_holds':sum(bool(h.get('polygon')) for h in context['holds']),
                             'allowed_moves':len(context['allowed_moves']),'quality':context['input_quality']}}

def request_headers(key):
    return {'Content-Type':'application/json','Trace-Id':str(uuid.uuid4()),
            **({'Authorization':'Bearer '+key} if key else {})}


class CompletionError(ValueError):
    """A safe, application-authored explanation, never raw provider text."""


def model_options(base,model):
    # Verified against JoyMaas Qwen3.6: default thinking can consume the entire
    # completion budget before emitting any final JSON. Keep live cues direct.
    if is_joymaas(base) and model=='Qwen3.6-35B-A3B':
        return {'chat_template_kwargs':{'enable_thinking':False}}
    return {}


def completion(response):
    data=response.json();choice=data['choices'][0]
    if choice.get('finish_reason')=='length':
        raise CompletionError('模型输出达到长度上限，未获得完整指导；未下发指令。')
    content=choice['message']['content']
    if not isinstance(content,str) or not content.strip():
        raise CompletionError('模型未返回最终答案；请检查思考模式和输出额度后重试。')
    raw=data.get('usage') or {}
    usage={k:raw[k] for k in ('prompt_tokens','completion_tokens','total_tokens') if isinstance(raw.get(k),int)}
    reasoning=(raw.get('completion_tokens_details') or {}).get('reasoning_tokens')
    if isinstance(reasoning,int):usage['reasoning_tokens']=reasoning
    return content,usage


def upstream_error(exc):
    if isinstance(exc,CompletionError):
        return HTTPException(502,str(exc))
    if isinstance(exc,httpx.TimeoutException):
        return HTTPException(504,'大模型响应超时；请暂停画面后重试，未下发指令。')
    if isinstance(exc,httpx.HTTPStatusError):
        status=exc.response.status_code
        if status in (401,403):
            # Only classify known provider errors; never echo arbitrary response
            # bodies, credentials or image payloads back to the browser.
            try:
                error=exc.response.json().get('error',{})
                identity_error=isinstance(error,dict) and any(
                    '实名认证' in str(error.get(k,'')) for k in ('cause','message'))
            except (ValueError,AttributeError):
                identity_error=False
            if identity_error:
                return HTTPException(502,'京东账号实名认证未通过，请在此 API Key 所属账号完成或核实实名认证后再测试；本次未下发指令。')
        detail={401:'模型服务返回 401（本次鉴权未通过）；请重试，持续失败再检查 API Key 和模型权限。',403:'账号无模型访问权限，请在 JoyMaas 开通模型。',
                429:'模型额度不足或请求过于频繁，请稍后重试。',
                400:'模型拒绝请求格式，请核对图片输入和模型参数。'}.get(status,f'模型服务返回 HTTP {status}，未下发指令。')
        return HTTPException(502,detail)
    return HTTPException(502,'指导请求失败或模型指令未通过校验；没有下发该指令。请重新观察后重试。')


def require_config():
    if not configured():
        raise HTTPException(503,'请在项目 .env 设置 CLIMBCUE_COACH_API_KEY；默认使用 JoyMaas Qwen3.6-35B-A3B。保存后点击测试连接，无需重启。')
    return config()


def build_messages(body,context):
    text=json.dumps(context,ensure_ascii=False)
    content=text
    if body.frame_images:
        content=[{'type':'text','text':text},
                 {'type':'text','text':'图片 1：与 snapshot 对应的原始画面，未镜像。'},
                 {'type':'image_url','image_url':{'url':body.frame_images.raw}}]
        if body.frame_images.annotated:
            content.extend([{'type':'text','text':'图片 2：同一帧的辅助岩点编号图；标记为人工或算法候选，不证明接触或承重。'},
                            {'type':'image_url','image_url':{'url':body.frame_images.annotated}}])
    return [{'role':'system','content':PROMPT_PATH.read_text()}, {'role':'user','content':content}]


async def test_connection():
    """Two explicit small paid requests: text authentication and image transport."""
    base,model,key=require_config()
    results=[]
    buf=io.BytesIO();Image.new('RGB',(64,64),(0,0,255)).save(buf,format='JPEG')
    url='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
    checks=[('text','只回复 OK。'),('image',[{'type':'text','text':'图片主体是什么颜色？只回复中文颜色名称。'},
                                         {'type':'image_url','image_url':{'url':url}}])]
    for kind,content in checks:
        start=time.perf_counter();headers=request_headers(key)
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response=await client.post(base+'/chat/completions',headers=headers,json={
                    'model':model,'messages':[{'role':'user','content':content}],'stream':False,'max_tokens':512,
                    **model_options(base,model)})
                response.raise_for_status()
                answer,usage=completion(response)
                ok='OK' in answer.upper() if kind=='text' else '蓝' in answer
                results.append({'kind':kind,'passed':ok,'answer':answer[:120],
                                'elapsed_ms':round((time.perf_counter()-start)*1000,1),'trace_id':headers['Trace-Id'],'usage':usage})
        except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError) as exc:
            results.append({'kind':kind,'passed':False,'error':upstream_error(exc).detail,
                            'elapsed_ms':round((time.perf_counter()-start)*1000,1),'trace_id':headers['Trace-Id']})
            break
    return {'model':model,'passed':len(results)==2 and all(r['passed'] for r in results),'checks':results,
            'note':'仅验证文本、图片接口；不代表攀岩指导准确率或实时性。'}


async def generate(body,store):
    start=time.perf_counter()
    hits=store.search('攀岩 脚法 重心 支撑 读线 '+body.user_goal,limit=3,category='technique')
    hits=[h for h in hits if h['card']['content_level']!='metadata']
    context=build_context(body,hits)
    if body.mode=='preview':
        plan=preview_plan(context)
    else:
        base,model,key=require_config()
        if is_joymaas(base) and not body.frame_images:
            raise HTTPException(422,'看图指导需要当前帧图片，请刷新网页后重新分析。')
        headers=request_headers(key)
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response=await client.post(base+'/chat/completions',headers=headers,json={
                    'model':model,'temperature':.1,'max_tokens':1000,'stream':False,
                    'messages':build_messages(body,context),**model_options(base,model)})
                response.raise_for_status()
                content,usage=completion(response)
                content=re.sub(r'^```(?:json)?\s*|\s*```$','',content.strip())
                plan=Plan.model_validate_json(content)
                validate_plan(plan,context)
        except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError) as exc:
            raise upstream_error(exc) from None
    validate_plan(plan,context)
    result=present(plan,context,body.mode,model if body.mode=='llm' else None,(time.perf_counter()-start)*1000)
    result['input_summary']['images']=int(body.frame_images is not None)*(1+int(bool(body.frame_images and body.frame_images.annotated))) if body.mode=='llm' else 0
    result['trace_id']=headers['Trace-Id'] if body.mode=='llm' else None
    result['usage']=usage if body.mode=='llm' else None
    return result
