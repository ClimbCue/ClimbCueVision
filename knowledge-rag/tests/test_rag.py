from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from climbcue_rag.store import KnowledgeCard, KnowledgeStore, markdown_cards, read_cards


def card(**changes):
    raw = dict(id="foot", title="脚法与踩点", text="踩点可以观察脚部位置。", source="user:authorized-coach-note",
               rights="test fixture", category="technique", tags=["脚法", "踩点"],
               applicability="测试", limitations="非真实建议", status="reviewed", review_note="测试审核",
               reviewed_at=datetime.now(timezone.utc)-timedelta(days=1))
    raw.update(changes)
    return KnowledgeCard(**raw)


def test_chinese_retrieval_persists_and_has_sources(tmp_path):
    db = tmp_path/"kb.db"
    KnowledgeStore(db).ingest([card()])
    hits, excerpts = KnowledgeStore(db).retrieve("右脚踩点脚法")
    assert hits[0]["card"]["id"] == "foot"
    assert excerpts[0]["source"] == "user:authorized-coach-note"
    assert excerpts[0]["reviewed"] and excerpts[0]["id"].startswith("kb.foot.")


def test_draft_expired_retired_and_future_review_excluded(tmp_path):
    store = KnowledgeStore(tmp_path/"db")
    now = datetime.now(timezone.utc)
    store.ingest([card(), card(id="draft",status="draft",reviewed_at=None),
                  card(id="expired", expires_at=now-timedelta(seconds=1)), card(id="retired",status="retired"),
                  card(id="future",reviewed_at=now+timedelta(days=1))])
    assert [h["card"]["id"] for h in store.search("脚法")] == ["foot"]
    assert {h["card"]["id"] for h in store.search("脚法",include_drafts=True)} == {"foot","draft"}
    assert len(store.retrieve("脚法")[1]) == 1


def test_retirement_and_replacement_invalidate_citation(tmp_path):
    store = KnowledgeStore(tmp_path/"db")
    c = card();store.ingest([c]);original=store.retrieve("脚法")[1][0]["id"]
    store.ingest([card(text="脚法观察内容已修订。")])
    assert store.retrieve("脚法")[1][0]["id"] != original
    store.ingest([card(status="retired")])
    assert store.search("脚法") == []


def test_import_atomic_duplicate_and_invalid(tmp_path):
    store=KnowledgeStore(tmp_path/"db");store.ingest([card()])
    with pytest.raises(ValueError):store.ingest([card(id="new"),card(id="new")])
    with pytest.raises(ValidationError):store.ingest([card(id="new"),{"id":"invalid"}])
    assert store.stats()["total"] == 1
    with pytest.raises(ValidationError):card(reviewed_at=None)


def test_safe_query_and_draft_markdown(tmp_path):
    store=KnowledgeStore(tmp_path/"db")
    chunks=markdown_cards("# 脚法笔记\n"+"观察当前踩点。"*150,source="user:notes.md",title="教练笔记")
    assert len(chunks)>1 and max(len(c.text) for c in chunks)<=600
    store.ingest(chunks)
    assert store.search("脚法") == []
    assert store.search("脚法", include_drafts=True)
    assert store.search('" OR * ( ) --') == []
    assert store.stats()["total"] == len(chunks)


def test_seed_retrieval_regressions(tmp_path):
    seed=Path(__file__).parents[1]/"data/seed.jsonl"
    store=KnowledgeStore(tmp_path/"db");store.ingest(read_cards(seed))
    cases={"脚法踩点":"footwork-basics","侧拉平衡":"balance-sidepull","髋部省力":"hip-efficiency",
           "单个IMU传感器":"imu-boundary","停顿卡点":"pause-observation","岩点邻近接触":"contact-boundary"}
    for query,expected in cases.items():
        assert expected in [h["card"]["id"] for h in store.search(query,limit=3)]
    assert store.search("量子计算") == []
