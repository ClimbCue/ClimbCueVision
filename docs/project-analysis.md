# 项目目录分析与落地方案

## 初始状态

根目录原先只有简短记录、`knowledge-rag/`、`vision-demos-main/`、`testvideos/`，没有统一应用配置或网页入口。所有原始目录均保留，新增网页不会调用付费云端视觉模型。

| 目录 | 已有功能与依赖 | 本次处理 |
| --- | --- | --- |
| `vision-demos-main/rock_climbing/` | 离线攀岩分析；SAM 3.1 分割岩点/地面，ViTPose 人体，SIFT/单应性相机配准，岩点邻近、顺序、轨迹和多次尝试比较；依赖 VLM Run 密钥、OpenCV、NumPy、FFmpeg | 保留离线流程。它按视频批量请求云模型，不适合直接当浏览器摄像头实时接口 |
| `vision-demos-main/rock_climbing_3d/` | 在上述流程上增加 LiDAR 深度、相机内参与米制几何 | 保留。原有 MP4 无深度数据，不能验证 3D 流程 |
| `vision-demos-main/dance_sync/` | 舞蹈姿态比较、同步相似度和视频渲染 | 原始示例，不接入本次测试页 |
| `vision-demos-main/chin_ups/` | 下巴引体计次与上升/下降计时 | 原始示例 |
| `vision-demos-main/pull_ups/` | 个体悬垂标定、引体次数和动作范围判断 | 原始示例 |
| `vision-demos-main/running/` | 步频、落脚时刻、膝角和可视化 | 原始示例 |
| `vision-demos-main/deadlift/` | 杠铃片分割、姿态与硬拉状态；另用 Gemma 做视觉判读 | 原始示例，依赖云模型 |
| `knowledge-rag/src/climbcue_rag/` | Pydantic 卡片契约、SQLite FTS5/BM25、中文双字分词、审核门槛、JSONL/Markdown CLI | 直接复用并扩展视频字段；修复默认数据库路径 |
| `knowledge-rag/data/` | 8 张种子卡、8 条回归查询 | 保留并修正 3 张边界卡中不存在的旧仓库引用 |
| `knowledge-rag/tests/` | 检索、审核、过期、事务、退役、引用哈希等测试 | 保留并在统一测试入口运行 |
| `testvideos/` | 两段 H.264 攀岩竖屏视频，720 × 1280 | 真实模型推理测试素材；网页可播放和选择 |

原 RAG 文档提到的 `projects/body-perception`、`crux-analysis` 等模块并未随当前仓库提供，原命令无法直接复现。文档已按当前实际实现重写，不再声称存在 IMU 接线或旧分析引擎集成。

## 当前实现

新增 `web/` 为统一测试应用，使用 FastAPI 提供 HTML/JS、JSON API 和支持 Range 的本地视频资源。仅绑定 localhost。`pyproject.toml` + `uv.lock` 管理 Python；`package.json` + `package-lock.json` 管理 MediaPipe 与浏览器验证工具。

实时姿态流为：摄像头/视频 → Canvas 捕获缩放帧 → 模块 Worker 中 MediaPipe Pose Lite / Full 推理 → 返回原帧和 33 点 → 同帧绘制骨架/表格/角度 → 有界帧历史和导出。可选 30 / 15 FPS 调度上限以平衡响应与 CPU 占用，具体吞吐由设备决定；只有前一帧处理完毕才提交下一帧。WASM、模型与 JS 均本地托管，不依赖运行时 CDN。

知识流为：JSONL/用户文本 → 卡片校验与草稿/审核状态 → SQLite 索引 → 检索过滤 → 引用快照 → 提取式摘要或可选大模型回答。生成模式保留适用条件、限制，验证模型引用属于本次证据。没有正文时拒绝生成技术结论。视频元数据只承担资源发现功能。

新增 `knowledge-library/` 归档文章、视频来源清单和导入草稿。网页使用 `web/runtime/knowledge.sqlite3`，与旧的包内运行库隔离。首次启动只添加缺失 ID；内容更新、审核和退役通过 CLI 显式导入。

## 本次验证范围

完成真实视频姿态、可见度门槛、二维角度、数据导出、两页联通、检索引用、无结果、草稿导入、视频目录筛选与响应式布局验证。离线云模型示例未执行，因为它们不属于新增两页运行链路，且依赖独立凭据/环境。详细证据见 [验证报告](verification.md)。

2026-10-17 后续扩展：恢复专题增加 32 份来源文档和 76 张卡片；姿态页新增 Lite / Full 切换及攀岩观察指标。本机模型实测与当前能力表见 [本地模型与攀岩指标](local-models-and-climbing.md)。
