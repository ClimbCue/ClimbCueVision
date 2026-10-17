# 恢复与拉伸专题验证记录

日期：2026-10-17。此次只扩充恢复知识与检索界面；实时姿态模型未改动。

## 本次资料

- 32 个独立原始来源，32 份原创中文 Markdown 摘要文档，76 张恢复知识卡片。
- 来源类型：9 份攀岩教练指导、11 份机构健康指南、6 份临床康复指南、3 份系统综述、2 份实验研究、1 份专家共识。
- 总库：109 张卡片，108 张来源/目录已核对，1 张草稿；47 个来源标识，9 个官方视频入口及 2 段本地视频。
- 来源清单和维护源：`knowledge-library/recovery/sources.json`；中文目录：`knowledge-library/recovery/documents/INDEX.md`。
- 未复制第三方全文或图示。公开研究摘要的核对范围逐项注明；来源核对不代表临床专业审核。通用运动或康复资料明确保留外推到攀岩的限制。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 49 项通过，包括原有功能回归、文档/卡片一致性、分类过滤和引用校验 |
| CLI 原有检索评估 `knowledge-rag/data/eval.json` | 8 / 8，通过新增语料后的回归 |
| CLI 恢复检索评估 `knowledge-rag/data/recovery-eval.json` | 26 / 26，包括 24 条相关问题、2 条无关问题；全库检索 top 3 |
| `npm run test:knowledge` | Chrome 实际页面通过：76 条专题书架、主题过滤、前臂/酸痛/睡眠问答、中文文档下载、无结果返回、视频入口回归 |
| 页面布局 | 检查桌面截图及 390px 手机截图，无横向溢出；浏览器脚本错误 0 |

自动化曾发现“泡沫轴可以修复滑车吗”只返回收益卡，没有返回局限卡。补充局限卡的基础主题检索词后，两卡可一起检出，局限卡排名第一；保留此问句作为回归样例。

截图及浏览器结果：`artifacts/recovery-desktop.png`、`recovery-mobile.png`、`recovery-mobile-answer.png`、`recovery-browser-report.json`；下载样例：`artifacts/recovery-document.md`。这些测试产物不提交。

检索回归是人工策划样例，不代表任意自然语言问题的准确率。当前使用 SQLite FTS5 / BM25 中文二元分词；本次验证的是检索摘要和可追溯引用，没有调用未配置的在线大模型。pytest 有一条 Starlette / httpx 依赖弃用提示，不影响测试结果。

## 当前姿态模型

`web/static/pose-worker.js` 加载本地 `pose_landmarker_lite.task`：MediaPipe Pose Landmarker Lite，float16 / version 1，浏览器 Web Worker 中 CPU + WebAssembly 推理，单人 33 个关键点。模型文件约 5.78 MB。

原有 `vision-demos-main/rock_climbing` 离线示例使用 SAM3.1 与 ViTPose+ Large，属于另一条分析流程。本次知识扩充没有切换或重新验证实体摄像头模型精度。
