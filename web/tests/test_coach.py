import json
import base64
import io

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from web.app import create_app
from web.coach import CoachInput, Plan, build_context, validate_plan, present
from PIL import Image


@pytest.fixture(autouse=True)
def isolate_coach_config(tmp_path,monkeypatch):
    # Never let unit tests read a developer's credentials or call a real provider.
    import web.coach_settings as settings
    monkeypatch.setattr(settings,'ENV_PATH',tmp_path/'.env')
    for scope in ('COACH','LLM'):
        for key in ('BASE_URL','MODEL','API_KEY'):
            monkeypatch.delenv(f'CLIMBCUE_{scope}_{key}',raising=False)


def images():
    buf=io.BytesIO();Image.new('RGB',(64,64),'blue').save(buf,format='JPEG')
    url='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
    return dict(snapshot_id='test:1',width=64,height=64,raw=url,annotated=url)


def sample():
    points=[None]*33
    for i,x,y in [(11,.4,.3),(12,.6,.3),(13,.35,.4),(14,.65,.4),(15,.3,.5),(16,.7,.5),
                  (23,.4,.5),(24,.6,.5),(25,.4,.7),(26,.6,.7),(27,.4,.88),(28,.6,.88),(31,.4,.9),(32,.6,.9)]:
        points[i]={'x':x,'y':y,'visibility':.9}
    return dict(snapshot_id='test:1',frame=10,video_seconds=2,width=1000,height=1000,model='rtmpose-s',
                landmarks=points,fixed_camera=True,movement='low_motion',history_frames=20,
                holds=[{'id':1,'x':.3,'y':.5},{'id':2,'x':.7,'y':.5},{'id':3,'x':.6,'y':.9},{'id':4,'x':.45,'y':.85}],
                confirmed_supports={'leftHand':1,'rightHand':2,'rightFoot':3})


def test_allowed_move_requires_other_three_supports():
    body=CoachInput(**sample());context=build_context(body,[])
    assert {'limb':'leftFoot','target_hold_id':4,'projection_only':True} in context['allowed_moves']
    plan=Plan(action='test_move',limb='leftFoot',target_hold_id=4,reason='其他三个支点由用户核对，目标通过二维距离筛选。',evidence_ids=['supports','hold.4'])
    validate_plan(plan,context)
    result=present(plan,context,'llm','test',10)
    assert result['glasses']['text']==result['web']['instruction']=='左脚试探 #4'
    assert len(result['glasses']['text'])<=20
    body.confirmed_supports={}
    with pytest.raises(ValueError):validate_plan(plan,build_context(body,[]))


@pytest.mark.parametrize('mutation',[{'fixed_camera':False},{'movement':'moving'},{'history_frames':0},{'detected_people':2},{'detected_people':0}])
def test_unstable_context_blocks_move(mutation):
    body=sample();body.update(mutation)
    assert not build_context(CoachInput(**body),[])['allowed_moves']


def test_unknown_target_and_citation_rejected():
    c=build_context(CoachInput(**sample()),[])
    for kw in [dict(target_hold_id=99),dict(target_hold_id=4,citations=['fake'])]:
        with pytest.raises(ValueError):validate_plan(Plan(action='inspect_hold',reason='核实目标',evidence_ids=['quality'],**kw),c)
    body=sample();body['confirmed_supports']['leftHand']=99
    with pytest.raises(ValidationError):CoachInput(**body)
    body=sample();body['landmarks'][11]['x']=float('nan')
    with pytest.raises(ValidationError):CoachInput(**body)


def test_coach_preview_and_unconfigured_llm(tmp_path,monkeypatch):
    for name in ['CLIMBCUE_COACH_BASE_URL','CLIMBCUE_COACH_MODEL','CLIMBCUE_LLM_BASE_URL','CLIMBCUE_LLM_MODEL']:
        monkeypatch.delenv(name,raising=False)
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        assert not client.get('/api/coach/config').json()['configured']
        assert 'allowed_moves' in client.get('/api/coach/prompt').json()['system_prompt']
        response=client.post('/api/coach/next',json=sample());assert response.status_code==200
        data=response.json();assert data['mode']=='preview' and not data['model_executed']
        assert data['glasses']['text']==data['web']['instruction']
        response=client.post('/api/coach/next',json=dict(sample(),mode='llm'));assert response.status_code==503


def test_llm_contract_validates_and_rejects_unobserved_move(tmp_path,monkeypatch):
    monkeypatch.setenv('CLIMBCUE_COACH_BASE_URL','https://example.test/v1')
    monkeypatch.setenv('CLIMBCUE_COACH_MODEL','fixture-model')
    import web.coach as coach
    plan=dict(action='inspect_hold',limb=None,target_hold_id=4,reason='先观察用户确认的目标。',evidence_ids=['hold.4'],cautions=[],citations=[])
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':json.dumps(plan)}}]}
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            assert url=='https://example.test/v1/chat/completions'
            context=json.loads(kwargs['json']['messages'][1]['content']);assert 'allowed_moves' in context
            assert not any('image' in m for m in kwargs['json']['messages'])
            return Response()
    monkeypatch.setattr(coach.httpx,'AsyncClient',Client)
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        r=client.post('/api/coach/next',json=dict(sample(),mode='llm'));assert r.status_code==200
        assert r.json()['model_executed'] and r.json()['glasses']['text']=='看 #4，确认下一点'
        plan.update(action='test_move',limb='rightHand',target_hold_id=99)
        assert client.post('/api/coach/next',json=dict(sample(),mode='llm')).status_code==502


def test_joymaas_images_and_trace_header(tmp_path,monkeypatch):
    import web.coach as coach
    monkeypatch.setenv('CLIMBCUE_COACH_API_KEY','fixture-secret')
    plan=dict(action='inspect_hold',target_hold_id=4,reason='先观察目标。',evidence_ids=['hold.4'])
    requests=[]
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':json.dumps(plan)}}]}
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            requests.append(kwargs)
            assert url=='https://modelservice.jdcloud.com/v1/chat/completions'
            assert kwargs['headers']['Authorization']=='Bearer fixture-secret'
            assert len(kwargs['headers']['Trace-Id'])==36
            payload=kwargs['json'];assert payload['model']=='Qwen3.6-35B-A3B'
            assert payload['stream'] is False
            assert payload['chat_template_kwargs']=={'enable_thinking':False}
            content=payload['messages'][1]['content'];context=json.loads(content[0]['text'])
            assert context['pose']['landmarks']==sample()['landmarks']
            assert context['custom_prompt']=='优先脚法'
            assert len([p for p in content if p['type']=='image_url'])==2
            assert content[2]['image_url']['url']==images()['raw']
            return Response()
    monkeypatch.setattr(coach.httpx,'AsyncClient',Client)
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        c=client.get('/api/coach/config');assert c.json()['configured']
        assert 'fixture-secret' not in c.text
        body=dict(sample(),mode='llm',frame_images=images(),custom_prompt='优先脚法')
        r=client.post('/api/coach/next',json=body);assert r.status_code==200,r.text
        assert r.json()['input_summary']['images']==2
        assert r.json()['glasses']['text']==r.json()['web']['instruction']
        assert r.json()['trace_id']==requests[0]['headers']['Trace-Id']
        body.pop('frame_images')
        assert client.post('/api/coach/next',json=body).status_code==422
        assert len(requests)==1


@pytest.mark.parametrize('mutation',[
    {'snapshot_id':'stale:2'},{'raw':'https://example.test/frame.jpg'},
    {'raw':'data:image/jpeg;base64,broken'},{'width':63},{'height':32},
])
def test_invalid_or_mismatched_images_rejected(mutation):
    frame=images();frame.update(mutation)
    with pytest.raises(ValidationError):CoachInput(**dict(sample(),frame_images=frame))


def test_dotenv_reload_and_environment_priority(tmp_path,monkeypatch):
    from web.coach_settings import config,configured
    path=tmp_path/'.env'
    assert not configured()
    path.write_text('CLIMBCUE_COACH_API_KEY="fixture-key" # local\n')
    assert configured() and config()[2]=='fixture-key'
    path.write_text('CLIMBCUE_COACH_API_KEY=changed\n')
    assert config()[2]=='changed'
    monkeypatch.setenv('CLIMBCUE_COACH_API_KEY','environment-value')
    assert config()[2]=='environment-value'


@pytest.mark.parametrize('status',[401,403,429,500])
def test_provider_errors_do_not_leak_response_or_credentials(tmp_path,monkeypatch,status):
    import web.coach as coach
    import httpx
    monkeypatch.setenv('CLIMBCUE_COACH_API_KEY','fixture-key')
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            return httpx.Response(status,request=httpx.Request('POST',url),text='secret-provider-body')
    monkeypatch.setattr(coach.httpx,'AsyncClient',Client)
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        r=client.post('/api/coach/next',json=dict(sample(),mode='llm',frame_images=images()))
        assert r.status_code==502
        assert 'fixture-key' not in r.text and 'secret-provider-body' not in r.text


def test_connection_checks_text_and_actual_image_payload(tmp_path,monkeypatch):
    import web.coach as coach
    import httpx
    monkeypatch.setenv('CLIMBCUE_COACH_API_KEY','fixture-key')
    calls=[]
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            content=kwargs['json']['messages'][0]['content'];calls.append(content)
            assert kwargs['json']['chat_template_kwargs']=={'enable_thinking':False}
            if isinstance(content,list):assert content[1]['image_url']['url'].startswith('data:image/jpeg;base64,')
            return httpx.Response(200,request=httpx.Request('POST',url),json={'choices':[{'message':{'content':'OK' if isinstance(content,str) else '蓝色'}}]})
    monkeypatch.setattr(coach.httpx,'AsyncClient',Client)
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        r=client.post('/api/coach/test');assert r.json()['passed'] and len(calls)==2
        assert [c['kind'] for c in r.json()['checks']]==['text','image']


def test_completion_rejects_exhausted_reasoning_and_empty_answers():
    import httpx
    from web.coach import completion,CompletionError,model_options
    for reason,content in [('length',None),('length','{}'),('stop',None),('stop','')]:
        r=httpx.Response(200,json={'choices':[{'finish_reason':reason,'message':{'content':content,'reasoning':'private thought'}}]})
        with pytest.raises(CompletionError):completion(r)
    r=httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'OK','reasoning':'private thought'}}],
                             'usage':{'prompt_tokens':100,'completion_tokens':2,'total_tokens':102,'completion_tokens_details':{'reasoning_tokens':0}}})
    answer,usage=completion(r)
    assert answer=='OK' and usage['reasoning_tokens']==0
    assert 'private thought' not in str((answer,usage))
    assert model_options('https://example.test/v1','other-model')=={}


def test_joymaas_identity_error_is_explicit_and_sanitized():
    import httpx
    from web.coach import upstream_error
    response=httpx.Response(401,request=httpx.Request('POST','https://modelservice.jdcloud.com/v1/chat/completions'),
        json={'error':{'cause':'未实名认证','message':'用户实名认证失败','secret':'must-not-echo'},'requestId':'fixture'})
    with pytest.raises(httpx.HTTPStatusError) as caught:response.raise_for_status()
    error=upstream_error(caught.value)
    assert error.status_code==502 and '实名认证' in error.detail
    assert 'must-not-echo' not in error.detail
