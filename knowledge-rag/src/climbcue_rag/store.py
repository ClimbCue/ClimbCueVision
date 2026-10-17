"""SQLite FTS5 retrieval with Chinese bigrams and explicit review gating."""
from datetime import datetime, timezone
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sqlite3

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from urllib.parse import urlparse


class KnowledgeCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=900)
    source: str = Field(min_length=1, max_length=400)
    rights: str = Field(min_length=1, max_length=200)
    category: Literal["technique", "observation", "equipment", "recovery"]
    tags: list[str] = Field(default_factory=list, max_length=12)
    applicability: str = Field(min_length=1, max_length=200)
    limitations: str = Field(min_length=1, max_length=200)
    status: Literal["draft", "reviewed", "retired"] = "draft"
    review_note: str = Field(default="", max_length=300)
    reviewed_at: datetime | None = None
    expires_at: datetime | None = None
    media_type: Literal["text", "video"] = "text"
    video_url: str | None = Field(default=None, max_length=500)
    content_level: Literal["summary", "metadata", "transcript"] = "summary"
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_review(self):
        for value in (self.reviewed_at, self.expires_at):
            if value and value.tzinfo is None:
                raise ValueError("Review/expiry dates need timezone")
        if self.status == "reviewed" and (not self.review_note or not self.reviewed_at):
            raise ValueError("Reviewed cards require review provenance and timestamp")
        if any(len(t) > 40 for t in self.tags):
            raise ValueError("Tag too long")
        if self.video_url:
            url = urlparse(self.video_url)
            if url.scheme not in ("https", "http") or not url.netloc:
                raise ValueError("Video URL must be HTTP(S)")
        if self.end_seconds is not None and (self.start_seconds is None or self.end_seconds <= self.start_seconds):
            raise ValueError("End time must follow start time")
        return self

    def eligible(self, now=None):
        now = now or datetime.now(timezone.utc)
        return (self.status == "reviewed" and self.reviewed_at <= now
                and (self.expires_at is None or self.expires_at > now))

    @property
    def citation_id(self):
        digest = hashlib.sha256(self.model_dump_json().encode()).hexdigest()[:12]
        return f"kb.{self.id}.{digest}"

    def excerpt(self):
        return {"id": self.citation_id, "text": f"{self.title}：{self.text}\n适用：{self.applicability}\n限制：{self.limitations}",
                "source": self.source, "reviewed": self.eligible()}


def tokens(text):
    """Pre-tokenize Chinese for portable SQLite; no external tokenizer model."""
    result = []
    for part in re.findall(r"[a-z0-9_]+|[\u3400-\u9fff]+", text.lower()):
        if re.fullmatch(r"[\u3400-\u9fff]+", part):
            result.extend(part[i:i+2] for i in range(len(part)-1))
            if len(part) == 1:
                result.append(part)
        else:
            result.append(part)
    return result


class KnowledgeStore:
    def __init__(self, db):
        self.path = Path(db)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, body)")

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=5)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def ingest(self, cards):
        cards = [KnowledgeCard.model_validate(c) for c in cards]
        if len(cards) > 2000 or len({c.id for c in cards}) != len(cards):
            raise ValueError("At most 2000 unique cards per import")
        with self.connect() as conn:
            for card in cards:
                conn.execute("INSERT OR REPLACE INTO cards VALUES (?,?)", (card.id, card.model_dump_json()))
                conn.execute("DELETE FROM search WHERE id=?", (card.id,))
                # Status/expiry are checked at query time, so retiring replaces an existing hit.
                body = " ".join(tokens(card.title + " " + " ".join(card.tags) + " " + card.text))
                conn.execute("INSERT INTO search (id,body) VALUES (?,?)", (card.id, body))
        return {"imported": len(cards), **self.stats()}

    def cards(self):
        with self.connect() as conn:
            return [KnowledgeCard.model_validate_json(row[0]) for row in conn.execute("SELECT payload FROM cards ORDER BY id")]

    def stats(self):
        cards = self.cards()
        return {"total": len(cards), "eligible": sum(c.eligible() for c in cards),
                "draft": sum(c.status == "draft" for c in cards), "backend": "sqlite_fts5_bm25_zh_bigrams"}

    def search(self, query, *, limit=4, include_drafts=False, category=None, media_type=None):
        if not 1 <= limit <= 6 or len(query) > 2000:
            raise ValueError("Query <=2000 characters; limit between 1 and 6")
        terms = list(dict.fromkeys(tokens(query)))[:64]
        if not terms:
            return []
        # Tokenizer emits no query operators/quotes; parameter binding protects SQL too.
        match = " OR ".join('"' + t + '"' for t in terms)
        with self.connect() as conn:
            rows = conn.execute("SELECT cards.payload, bm25(search) FROM search JOIN cards ON search.id=cards.id WHERE search MATCH ? ORDER BY bm25(search), cards.id", (match,)).fetchall()
        hits = []
        for payload, score in rows:
            card = KnowledgeCard.model_validate_json(payload)
            if not card.eligible() and not (include_drafts and card.status == "draft"):
                continue
            if category and card.category != category:
                continue
            if media_type and card.media_type != media_type:
                continue
            matched = [t for t in terms if t in tokens(card.title + ' ' + ' '.join(card.tags) + ' ' + card.text)]
            tagged = any(len(tag) >= 2 and tag.lower() in query.lower() for tag in card.tags)
            # A shared generic bigram (e.g. “计算”) must not alone retrieve an unrelated card.
            if not tagged and len(matched) / len(terms) < .5:
                continue
            hits.append({"card": card.model_dump(mode="json"), "citation_id": card.citation_id,
                         "eligible": card.eligible(), "score": round(-score, 8),
                         "matched_terms": matched})
            if len(hits) == limit:
                break
        return hits

    def retrieve(self, query, *, limit=4):
        hits = self.search(query, limit=limit)
        return hits, [KnowledgeCard.model_validate(h["card"]).excerpt() for h in hits]


def read_cards(path):
    path = Path(path)
    if path.stat().st_size > 5_000_000:
        raise ValueError("Knowledge file exceeds 5 MB")
    return [KnowledgeCard.model_validate_json(line) for line in path.read_text().splitlines() if line.strip()]


def markdown_cards(text, *, source, title):
    """Create draft chunks; no implicit source approval or automated promotion."""
    if not text.strip() or len(text) > 200_000:
        raise ValueError("Markdown must contain 1–200000 characters")
    key = hashlib.sha256(source.encode()).hexdigest()[:12]
    return [KnowledgeCard(id=f"md-{key}-{i}", title=title, text=text[start:start+600], source=source,
                          rights="user-supplied; verify permission before review", category="technique",
                          applicability="待审核适用条件", limitations="待审核；不可进入动作建议上下文")
            for i, start in enumerate(range(0, len(text), 540)) if text[start:start+600].strip()]
