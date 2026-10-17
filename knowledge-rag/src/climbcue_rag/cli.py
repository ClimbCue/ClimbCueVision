import argparse
import json
from pathlib import Path
import time
from .store import KnowledgeStore, markdown_cards, read_cards


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local climbing knowledge retrieval")
    parser.add_argument("--db", default=str(Path(__file__).resolve().parents[2] / "runtime/knowledge.sqlite3"))
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("ingest")
    ingest.add_argument("--input", required=True)
    md = sub.add_parser("draft-markdown")
    md.add_argument("--input", required=True)
    md.add_argument("--source", required=True)
    md.add_argument("--title", required=True)
    md.add_argument("--output", required=True)
    query = sub.add_parser("search")
    query.add_argument("--query", required=True)
    query.add_argument("--include-drafts", action="store_true")
    sub.add_parser("stats")
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("--cases", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "draft-markdown":
            cards = markdown_cards(Path(args.input).read_text(), source=args.source, title=args.title)
            out = Path(args.output)
            if out.resolve() == Path(args.input).resolve():
                raise ValueError("Output must differ from input")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("".join(c.model_dump_json()+"\n" for c in cards))
            result = {"draft_chunks": len(cards), "output": str(out)}
        else:
            store = KnowledgeStore(args.db)
            if args.command == "ingest":
                result = store.ingest(read_cards(args.input))
            elif args.command == "search":
                result = store.search(args.query, include_drafts=args.include_drafts)
            elif args.command == "evaluate":
                cases = json.loads(Path(args.cases).read_text())
                rows = []
                for case in cases:
                    begin = time.perf_counter()
                    hits = store.search(case["query"], limit=3)
                    ids = [h["card"]["id"] for h in hits]
                    expected = case["expected_id"]
                    passed = expected in ids if expected else not ids
                    rows.append({"query": case["query"], "expected_id": expected, "retrieved_ids": ids,
                                 "passed": passed, "latency_ms": round((time.perf_counter()-begin)*1000, 3)})
                result = {"scope": "Curated regression queries, not real-user accuracy", "cases": rows,
                          "passed": sum(r["passed"] for r in rows), "total": len(rows)}
            else:
                result = store.stats()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if args.command == "evaluate" and result["passed"] != result["total"]:
            return 1
        return 0
    except (ValueError, OSError):
        print("知识文件、字段或路径无效；请检查卡片契约。")
        return 2
