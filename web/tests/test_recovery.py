"""Corpus consistency and realistic recovery questions, with actual FTS retrieval."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from climbcue_rag.store import read_cards
from web.app import create_app

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / 'knowledge-rag/data/recovery-eval.json').read_text())


@pytest.fixture(scope='module')
def recovery_client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('recovery') / 'library.db')) as client:
        yield client


def test_sources_documents_and_index_are_consistent(recovery_client):
    catalog = json.loads((ROOT / 'knowledge-library/recovery/sources.json').read_text())['sources']
    cards = read_cards(ROOT / 'knowledge-library/articles/recovery-stretching.jsonl')
    assert len(catalog) == len({s['url'] for s in catalog}) == 32
    assert len(cards) == len({c.id for c in cards}) == 76
    by_id = {c.id:c for c in cards}
    for source in catalog:
        response = recovery_client.get(f"/recovery-docs/{source['id']}.md")
        assert response.status_code == 200
        assert source['url'] in response.text and source['limitations'] in response.text
        for entry in source['entries']:
            card = by_id[f"recovery-{source['id']}-{entry['key']}"]
            assert card.source == source['url'] and card.text in response.text
            assert card.eligible() and card.category == 'recovery'
            assert '未经过临床专业审核' in card.review_note
    assert recovery_client.get('/recovery-docs/INDEX.md').status_code == 200
    assert recovery_client.get('/recovery-docs/%2e%2e/sources.json').status_code == 404


@pytest.mark.parametrize('case', CASES, ids=[c['query'] for c in CASES])
def test_recovery_questions_and_citations(recovery_client, case):
    response = recovery_client.post('/api/knowledge/ask', json={'query':case['query'], 'category':'recovery'})
    assert response.status_code == 200
    result = response.json()
    ids = [h['card']['id'] for h in result['hits']]
    if case['expected_id'] is None:
        assert not ids and not result['citations']
        assert '没有足够' in result['answer']
    else:
        assert case['expected_id'] in ids
        assert all(h['card']['category'] == 'recovery' for h in result['hits'])
        assert result['citations'] and all(f'[{c}]' in result['answer'] for c in result['citations'])
        assert '限制：' in result['answer'] and not result['model_executed']


def test_category_filters_do_not_leak_other_content(recovery_client):
    cards = recovery_client.get('/api/knowledge/cards?category=recovery').json()
    assert len(cards) == 76 and all(c['category']=='recovery' for c in cards)
    assert recovery_client.get('/api/knowledge/cards?category=recovery&media_type=video').json() == []
    for endpoint in ('ask', 'search'):
        assert not recovery_client.post(f'/api/knowledge/{endpoint}',json={'query':'脚法踩点','category':'recovery'}).json()['hits']
        assert not recovery_client.post(f'/api/knowledge/{endpoint}',json={'query':'泡沫轴','category':'technique'}).json()['hits']
        assert recovery_client.post(f'/api/knowledge/{endpoint}',json={'query':'拉伸','category':'invalid'}).status_code == 422
