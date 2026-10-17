"""Explicit live smoke test; reads credentials locally, never prints them.

Usage: .venv/bin/python scripts/test-joymaas.py --input artifacts/coach-vision-input.json
Runs two small connectivity requests and, if supplied, one actual coaching request.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fastapi import HTTPException
from web.coach import CoachInput, configured, generate, test_connection
from web.app import seed_library
from climbcue_rag.store import KnowledgeStore


async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',type=Path)
    args=parser.parse_args()
    report={'time':datetime.now(timezone.utc).isoformat(),'real_llm_called':False}
    code=0
    if not configured():
        report.update(status='blocked_missing_api_key',message='在项目 .env 设置 CLIMBCUE_COACH_API_KEY 后重试。')
        code=2
    else:
        report['real_llm_called']=True
        report['connection']=await test_connection()
        report['status']='passed' if report['connection']['passed'] else 'connection_failed'
        if not report['connection']['passed']:code=1
        elif args.input:
            body=CoachInput.model_validate_json(args.input.read_text()).model_copy(update={'mode':'llm'})
            store=KnowledgeStore(ROOT/'web/runtime/knowledge.sqlite3');seed_library(store)
            try:
                report['coaching']=await generate(body,store)
                report['note']='暂停测试帧的历史分析，不是当前实时指令；人工测试标记不代表真实支点标签。'
            except HTTPException as exc:
                report.update(status='coaching_failed',error=exc.detail);code=1
    output=ROOT/'artifacts/joymaas-live-report.json';output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return code


if __name__=='__main__':sys.exit(asyncio.run(main()))
