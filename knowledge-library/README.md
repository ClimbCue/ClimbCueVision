# 攀岩资料目录

网页入口：`http://127.0.0.1:8000/knowledge`。

| 路径 | 内容 |
| --- | --- |
| `articles/techniques.jsonl` | 16 张新增知识卡：摩擦踩点、外侧踩点、旗式、对撑、勾脚、翻越、休息与读线、岩点类型、岩场准入及环境保护 |
| `articles/recovery-stretching.jsonl` | 76 张恢复与拉伸卡片，分类为 `recovery` |
| [恢复文档目录](recovery/documents/INDEX.md) | 32 个独立来源的中文摘要文档，含原文链接、证据类型及适用限制 |
| `recovery/sources.json` | 恢复资料的维护源；生成脚本产出 Markdown 和 JSONL |
| `videos/catalog.jsonl` | 9 张 BMC 官方视频目录卡，可参与检索，但没有正文/逐字稿，不能充当问答技术证据 |
| `videos/sources.json` | 视频原始标题、官方来源、播放 URL、核对时间与内容层级 |
| `videos/local-videos.json` | 仓库中 2 段测试视频的文件映射；不复制视频文件 |
| `imports/` | 网页导入的笔记/字幕，自动切块并保存为草稿 |

加上 `knowledge-rag/data/seed.jsonl` 的 8 张原有卡片，初始化后共有 109 张：108 张来源/目录已核对、1 张草稿。核对不代表教练认证或临床审核。

文章仅保存简短原创中文概述，来源为 [REI 技术概念](https://www.rei.com/learn/expert-advice/climbing-techniques.html)、[REI 岩点类型](https://www.rei.com/learn/expert-advice/climbing-holds.html) 和 [BMC 环境与准入](https://thebmc.co.uk/en/respect-the-rock)。每张卡附适用条件、限制、使用权说明与审核日期。

视频从 BMC 官方页面读取标题和嵌入视频 ID。保留官方播放链接，不复制视频/图片/第三方字幕，也不声称看过或转录了视频。网页可以播放项目自带视频，外部资料点链接跳转官方播放器。播放可用性仍取决于外部平台与网络。

## 扩充自己的资料

1. 在网页“导入笔记或视频字幕”中上传 MD/TXT/SRT/VTT 或粘贴正文，填写标题、来源和使用权；字幕可同时填写视频 URL。
2. 导入按 600 字切块、60 字重叠，保存到 `imports/<内容哈希>.jsonl`，同时写入本地 SQLite。重复导入不覆盖已有审核版本。
3. 在 JSONL 文件中核对内容、适用条件和限制，填写 `review_note` 与带时区的 `reviewed_at`，将 `status` 从 `draft` 改为 `reviewed`。
4. 在仓库根目录执行：

```bash
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 ingest --input knowledge-library/imports/<文件名>.jsonl
```

网页刷新即可查看。若要退出检索，将状态改为 `retired` 后重新入库。重启不会把已退役的记录恢复。导入字幕目前是通用文本切块；不会自动转录视频，不会解析成精确时间轴。卡片契约支持可选 `start_seconds/end_seconds`，可人工维护。

共享知识只收录有来源、有权使用的资料。用户视频不自动进入通用教学知识。

## 恢复专题维护与验证

编辑 `recovery/sources.json` 后执行 `.venv/bin/python scripts/build-recovery-library.py`，同步生成 32 份文档和 76 张卡片。首次添加的新 ID 在服务重启时自动入库；修改已有卡片后需显式执行以下命令，重启本身不会覆盖已审核或退役记录：

```sh
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 ingest --input knowledge-library/articles/recovery-stretching.jsonl
```

网页“恢复拉伸”书架和“恢复与拉伸”检索主题都可查看专题。卡片提供原始来源与中文 Markdown 下载。研究摘要保留人群及证据限制，医疗机构资料不作为个人诊疗方案；未成功读取的来源未计入这 32 份文档。

验证：`.venv/bin/python -m pytest -q`；启动本地服务后运行 `npm run test:knowledge`。新增 26 条检索回归样例见 `knowledge-rag/data/recovery-eval.json`。
