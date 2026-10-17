# 攀岩知识检索包

`climbcue-rag` 是独立 Python 包。当前网页入口在根目录 `web/`，运行方式见 [项目说明](../readme.md)。原移植项目的 `projects/`、`crux-analysis`、`body-perception` 不在本仓库，旧文档中的调用命令已移除。

实现 SQLite FTS5 + BM25、中文双字分词、英文词检索与标签/词覆盖过滤。内容版本哈希构成引用 ID；草稿、退役、过期和未来审核的资料默认不进入检索。支持 JSONL 事务导入、Markdown 草稿切块、视频 URL、元数据/摘要/逐字稿类型及可选开始/结束秒数。

网页默认执行检索式摘要，可选连接兼容大模型服务。视频目录不参与技术问答正文。没有自动转录、向量嵌入或语义重排。

## CLI

在仓库根目录执行 `uv sync`。CLI 默认库是本包的 `runtime/knowledge.sqlite3`；网页使用独立的 `web/runtime/knowledge.sqlite3`，需显式传入 `--db`：

```bash
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 stats
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 search --query '旗式平衡'
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 evaluate --cases knowledge-rag/data/eval.json
.venv/bin/climbcue-rag draft-markdown \
  --input /absolute/path/authorized-notes.md \
  --source 'user:authorized-coach-notes' --title '教练笔记' \
  --output knowledge-library/imports/draft-notes.jsonl
```

审核后通过 `ingest --input <JSONL路径>` 入库。`reviewed` 需填写带时区的 `reviewed_at` 和 `review_note`；CLI 按文件声明导入，不代替人工核查。网页导入始终为草稿，重复导入不覆盖原记录。

原种子库有 7 张核对卡片和 1 张草稿；[新增资料目录](../knowledge-library/README.md) 包含 16 张文章知识卡与 9 个官方视频入口。启动仅导入缺失 ID，不覆盖维护后的资料。源码说明引用已修正为当前仓库的 [感知边界](../docs/measurement-boundaries.md)。

8 条原始评估查询与新增主题查询是回归用例，不是用户查询泛化准确率。词法检索可能漏掉同义表达。算法依据：[SQLite FTS5](https://www.sqlite.org/fts5.html)。
