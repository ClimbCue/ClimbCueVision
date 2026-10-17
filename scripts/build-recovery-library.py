"""Render authored recovery sources into readable documents and validated RAG cards.

Run with .venv/bin/python scripts/build-recovery-library.py.
Edit knowledge-library/recovery/sources.json; generated outputs are deterministic.
No remote full text or images are downloaded or redistributed.
"""
import json
from pathlib import Path

from climbcue_rag.store import KnowledgeCard

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "knowledge-library"


def build():
    catalog = json.loads((LIBRARY / "recovery/sources.json").read_text())
    docs = LIBRARY / "recovery/documents"
    docs.mkdir(parents=True, exist_ok=True)
    cards = []
    index = ["# 攀岩恢复与拉伸资料", "", catalog["curation_note"], "",
             f"核对日期：{catalog['checked_at']}。包含 {len(catalog['sources'])} 个独立来源。", "",
             "机构的通用指南不等于攀岩专项研究；临床康复方案需要专业人员个体化安排。",
             "拉伸用于活动范围训练，不承诺消除酸痛或加速组织修复。", "",
             "下列为中文学习摘要，完整动作图示、研究细节和最新修订请查看原始来源。", "",
             "| 中文文档 | 来源 / 证据类型 | 主题 | 卡片数 |", "| --- | --- | --- | --- |"]
    source_ids = set()
    for source in catalog["sources"]:
        sid = source["id"]
        assert sid not in source_ids, sid
        source_ids.add(sid)
        lines = [f"# {source['title']}", "", f"来源：[{source['publisher']}]({source['url']})", "",
                 f"资料类型：{source['evidence_type']} · 核对日期：{source['checked_at']}", "",
                 f"核对范围：{source['verification_scope']}。", "",
                 f"主题：{'、'.join(source['topics'])}", "", "## 中文学习摘要", ""]
        for entry in source["entries"]:
            card = KnowledgeCard(
                id=f"recovery-{sid}-{entry['key']}", title=entry["title"], text=entry["text"],
                source=source["url"], rights="原创中文简要概述；原文和图示版权归原作者，完整内容请访问原始来源。",
                category="recovery", tags=entry["tags"],
                applicability="攀岩者的恢复与活动度知识学习；动作仅在无疼痛且适合自身条件时参考。"
                if source["evidence_type"] not in ("系统综述", "实验研究", "专家共识")
                else "理解恢复方法的证据、研究对象和局限，不作为个人诊断或治疗依据。",
                limitations=source["limitations"], status="reviewed",
                review_note=f"{source['checked_at']} 来源核对：{source['verification_scope']}；{source['evidence_type']}。中文摘要由 Codex 整理，未经过临床专业审核。",
                reviewed_at=source["checked_at"] + "T00:00:00+08:00",
            )
            cards.append(card)
            lines += [f"### {entry['title']}", "", entry["text"], "",
                      f"检索词：{'、'.join(entry['tags'])}  \n卡片 ID：`{card.id}`", ""]
        lines += ["## 适用范围与限制", "", source["limitations"], "",
                  "本文件是原创简要概述，不是原文全文、完整动作教程或医疗处方。来源核对不代表临床审核。", "",
                  f"[阅读原始资料]({source['url']}) · [返回目录](INDEX.md)", ""]
        (docs / f"{sid}.md").write_text("\n".join(lines), encoding="utf-8")
        index.append(f"| [{source['title']}]({sid}.md) | {source['publisher']} / {source['evidence_type']} | {'、'.join(source['topics'])} | {len(source['entries'])} |")
    assert len({c.id for c in cards}) == len(cards)
    (LIBRARY / "articles/recovery-stretching.jsonl").write_text(
        "".join(c.model_dump_json() + "\n" for c in cards), encoding="utf-8")
    index += ["", f"合计：{len(source_ids)} 份来源文档、{len(cards)} 张可检索卡片。", "",
              "维护源：`knowledge-library/recovery/sources.json`。生成命令：",
              "```sh", ".venv/bin/python scripts/build-recovery-library.py", "```", ""]
    (docs / "INDEX.md").write_text("\n".join(index), encoding="utf-8")
    print(json.dumps({"sources": len(source_ids), "cards": len(cards)}, ensure_ascii=False))


if __name__ == "__main__":
    build()
