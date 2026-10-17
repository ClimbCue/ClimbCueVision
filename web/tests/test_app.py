import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from web.app import create_app, seed_library, generate_answer
from climbcue_rag.store import KnowledgeCard


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "knowledge.db")) as c:
        yield c


def test_pages_assets_and_range_video(client):
    assert client.get("/pose").status_code == 200
    assert client.get("/knowledge").status_code == 200
    clips = client.get("/api/videos").json()
    assert len(clips) >= 2
    partial = client.get(clips[0]["url"], headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206 and len(partial.content) == 100
    assert client.get("/media/%2e%2e/readme.md").status_code == 404


def test_library_sources_and_video_metadata(client):
    stats = client.get("/api/knowledge/stats").json()
    assert stats["total"] == 109 and stats["videos"] == 9
    assert stats["eligible"] == 108
    cards = client.get("/api/knowledge/cards?media_type=video").json()
    assert all(c["content_level"] == "metadata" and c["video_url"].startswith("https://www.youtube.com/watch?v=") for c in cards)
    assert len({c["video_url"] for c in cards}) == 9
    seed_library(client.app.state.store)
    assert client.get("/api/knowledge/stats").json() == stats


@pytest.mark.parametrize("query,expected",[("脚法踩点","footwork-basics"),("旗式 flagging","flagging"),("圆点 sloper","sloper"),("读线视频","bmc-route-reading"),("脚尖勾视频","bmc-toe-hook")])
def test_search_real_corpus(client,query,expected):
    response = client.post("/api/knowledge/search",json={"query":query}).json()
    assert expected in [h["card"]["id"] for h in response["hits"]]
    assert all(h["eligible"] and h["citation_id"].startswith("kb.") for h in response["hits"])


def test_answer_has_exact_citations_and_abstains(client):
    result = client.post("/api/knowledge/ask",json={"query":"旗式"}).json()
    assert not result["model_executed"] and result["mode"] == "extractive"
    assert result["citations"] and all(f"[{c}]" in result["answer"] for c in result["citations"])
    result = client.post("/api/knowledge/ask",json={"query":"量子计算"}).json()
    assert not result["hits"] and not result["citations"] and "没有足够" in result["answer"]
    result = client.post("/api/knowledge/ask",json={"query":"读线视频","media_type":"video"}).json()
    assert result["hits"] and not result["citations"] and "没有足够" in result["answer"]


def test_import_drafts_persist_without_overwrite(client,tmp_path,monkeypatch):
    import web.app as module
    monkeypatch.setattr(module,"LIBRARY",tmp_path)
    payload={"title":"测试脚法笔记","source":"user:own-notes","rights":"原创","text":"测试脚法：观察脚点。"}
    result=client.post("/api/knowledge/import",json=payload)
    assert result.status_code==200 and result.json()["imported"]==1
    assert len(list((tmp_path/"imports").glob("*.jsonl")))==1
    draft=[c for c in client.app.state.store.cards() if c.title==payload["title"]][0]
    assert draft.status=="draft"
    assert all(h["card"]["id"]!=draft.id for h in client.post("/api/knowledge/search",json={"query":"测试脚法"}).json()["hits"])
    draft.status="reviewed";draft.review_note="Reviewed test note";draft.reviewed_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc)
    client.app.state.store.ingest([draft])
    assert client.post("/api/knowledge/import",json=payload).json()["imported"]==0
    assert next(c for c in client.app.state.store.cards() if c.id==draft.id).status=="reviewed"


def test_validation_and_local_write_boundary(client,monkeypatch):
    for query in ["", "   ", "x"*2001]:
        assert client.post("/api/knowledge/search",json={"query":query}).status_code==422
    assert client.post("/api/knowledge/search",json={"query":"脚法","limit":100}).status_code==422
    assert client.post("/api/knowledge/ask",json={"query":"脚法"},headers={"Origin":"https://example.com"}).status_code==403
    monkeypatch.delenv("CLIMBCUE_LLM_BASE_URL",raising=False)
    assert client.post("/api/knowledge/ask",json={"query":"脚法","mode":"llm"}).status_code==503


def test_retired_records_not_resurrected_on_startup(client):
    store=client.app.state.store
    c=next(c for c in store.cards() if c.id=="flagging")
    c.status="retired";store.ingest([c]);seed_library(store)
    assert not store.search("flagging")


def test_bad_video_url_and_timestamps_rejected(client):
    card=next(c for c in client.app.state.store.cards() if c.id=="bmc-footwork").model_dump()
    with pytest.raises(ValidationError): KnowledgeCard(**{**card,"video_url":"javascript:alert(1)"})
    with pytest.raises(ValidationError): KnowledgeCard(**{**card,"start_seconds":20,"end_seconds":10})


@pytest.mark.parametrize("valid", [True,False])
def test_optional_llm_grounded_citation_contract(client,monkeypatch,valid):
    """Only protocol/citation validation is mocked; this is not a live LLM test."""
    import web.app as module
    monkeypatch.setenv("CLIMBCUE_LLM_BASE_URL","http://localhost:11434/v1")
    monkeypatch.setenv("CLIMBCUE_LLM_MODEL","test-model")
    citation=client.app.state.store.search("旗式")[0]["citation_id"]
    used=citation if valid else "kb.fabricated.000000000000"
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {"choices":[{"message":{"content":json.dumps({"answer":f"基于资料的回答 [{used}]","citations":[used]})}}]}
    class ModelClient:
        def __init__(self,**kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def post(self,url,**kwargs):
            assert url.endswith("/v1/chat/completions")
            context=json.loads(kwargs["json"]["messages"][1]["content"])
            assert context["evidence"][0]["citation_id"]==citation
            return Response()
    monkeypatch.setattr(module.httpx,"AsyncClient",ModelClient)
    response=client.post("/api/knowledge/ask",json={"query":"旗式","mode":"llm"})
    if valid:
        assert response.status_code==200 and response.json()["model_executed"]
        assert response.json()["citations"]==[citation]
    else:
        assert response.status_code==502


def test_video_transcript_draft_import(client,tmp_path,monkeypatch):
    import web.app as module
    monkeypatch.setattr(module,"LIBRARY",tmp_path)
    payload={"title":"自有视频字幕","source":"user:clip","rights":"本人创作","text":"00:00:01 脚法复盘", "video_url":"https://example.com/own-video"}
    assert client.post("/api/knowledge/import",json=payload).json()["imported"]==1
    card=next(c for c in client.app.state.store.cards() if c.title==payload["title"])
    assert card.media_type=="video" and card.content_level=="transcript" and not card.eligible()
    payload["video_url"]="https://?invalid"
    assert client.post("/api/knowledge/import",json=payload).status_code==422
