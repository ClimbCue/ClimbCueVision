# ClimbCue Vision Lab

本地攀岩功能测试工作台，提供两个独立页面：

- **实时姿态追踪**：<http://127.0.0.1:8000/pose> — 摄像头、文件视频、项目测试视频；6 种姿态模型切换、3 种岩点分割模型；骨架、原生关键点坐标、10 个二维关节角、重心观察代理、肢体伸展、固定机位移动节奏及手动岩点邻近、实际处理帧率，JSON/CSV 导出。
- **攀岩知识库**：<http://127.0.0.1:8000/knowledge> — 真实中文检索、带来源的摘要、可选大模型 RAG、视频书架、本地视频播放、笔记/字幕草稿导入。

## 启动

需要 Python 3.11/3.12、uv、Node.js 20+（本次使用 Node 24）和 Chrome/Chromium。

```bash
uv sync
npm ci
npm run setup:pose
uv pip install --python .venv/bin/python -r requirements-models.txt
npm run setup:models
.venv/bin/python -m uvicorn web.app:app --host 127.0.0.1 --port 8000
```

打开 <http://127.0.0.1:8000>。首次安装需要网络，`setup:pose` 将 MediaPipe WASM 和官方 Lite / Full / Heavy 模型存到本项目，并校验模型 SHA256。准备好后，姿态推理和检索摘要均可在无外网时运行。摄像头需要浏览器授权；MediaPipe 在浏览器 Worker 中运行；RTMPose、YOLO、SAM 系列将采样帧传到本机服务，使用 CPU 或 MPS，不上传云端。服务器默认只绑定本机，未设计为多人公网服务。

姿态页选择“攀爬测试视频 01/02”即可复现。点击暂停查看某帧，CSV 保存最近 1800 个采样帧的全部关键点，JSON 保存当前帧。视频循环、拖动进度和切换输入均可使用；停止会释放摄像头。可见度低于 0.5、超出画面或骨段退化时，角度显示为空。

## 知识库与视频

资料在 [knowledge-library](knowledge-library/README.md)，初始化后共 **109 张卡片**：原有 8 张 + 16 张技术文章知识 + 76 张恢复拉伸知识 + 9 个 BMC 官方视频入口。另关联 `testvideos/` 中原有的 2 段本地视频。

恢复与拉伸专题整理了 **32 份独立来源的中文摘要文档**，覆盖前臂手腕、肩背、髋腿、踝部、睡眠、饮食补水、负荷管理及恢复研究。[打开文档目录](knowledge-library/recovery/documents/INDEX.md)。网页支持“恢复与拉伸”主题筛选及中文文档下载；来源核对不代表临床审核。

外部视频保存经过核对的标题、来源与官方播放链接，未下载视频或自动转录，明确标注“未转录”。视频目录参与检索，但不会冒充技术证据。上传自己的笔记或字幕会保存到 `knowledge-library/imports/`，经过审核、用 CLI 入库后才进入问答。详见资料目录说明。

默认使用 SQLite FTS5/BM25 词法检索和可追溯的提取式摘要，不依赖模型密钥。没有匹配正文时明确返回证据不足。

可选大模型 RAG 使用兼容 Chat Completions 的服务。在启动服务器前设置：

```bash
export CLIMBCUE_LLM_BASE_URL='http://127.0.0.1:11434/v1'
export CLIMBCUE_LLM_MODEL='你的模型名'
# 远程服务如需要鉴权，再设置 CLIMBCUE_LLM_API_KEY
```

网页选择“大模型 RAG”。服务器传入检索正文、适用条件、限制及引用 ID，校验模型返回引用。未配置时返回清晰提示，不伪造模型回答。本次未配置真实大模型，模型接口仅通过模拟响应验证协议和引用拦截；引用 ID 合法不等于完成语义事实核查。

## 验证

```bash
.venv/bin/python -m pytest -q
npm test
.venv/bin/climbcue-rag --db web/runtime/knowledge.sqlite3 evaluate --cases knowledge-rag/data/eval.json
# 保持本机服务器运行，浏览器测试默认使用已安装的 Chrome
npm run test:e2e
```

自动验证包括两段真实视频推理、33 点输出、上传/拖动/循环、导出、模拟摄像头启停和权限失败、知识检索与无匹配返回、视频资料筛选、桌面/移动布局。浏览器结果、截图、JSON/CSV 位于 `artifacts/`（忽略提交）。实体摄像头效果需在本机手动验证。

目录分析与测试范围见 [项目分析](docs/project-analysis.md)、[验证报告](docs/verification.md)。测量含义与能力限制见 [感知边界](docs/measurement-boundaries.md)。

## 项目布局

```text
web/                   FastAPI 服务、两个网页、浏览器 Worker 与接口测试
knowledge-library/     新增文章、视频来源目录、导入草稿
knowledge-rag/         独立检索包及原始种子库
vision-demos-main/     原有离线云模型示例，保留独立运行方式
testvideos/           原有的 2 段攀爬测试视频
scripts/               模型资源准备、浏览器端到端验证
docs/                 项目分析、测量边界、验证报告
```

网页数据库为 `web/runtime/knowledge.sqlite3`。独立 CLI 默认库为 `knowledge-rag/runtime/knowledge.sqlite3`，维护网页库需指定 `--db web/runtime/knowledge.sqlite3`。启动只导入缺失 ID，不覆盖既有审核、修改或退役状态。

## 本机实时模型与攀岩指标

Apple M2 / 16 GB 的两段视频实测：Lite 约 24–26 FPS，Full 约 19–20 FPS（Chrome CPU/WASM）。默认 Lite，可在姿态页切换模型和 15/30 FPS 目标帧率。

重心观察目前为肩髋几何中心代理，不是实测质量中心；速度、停顿候选、岩点邻近需要勾选固定机位。完整公式、适用范围、尚未实现的分析项和 ViTPose / SAM 本地部署边界见 [本地模型与攀岩指标](docs/local-models-and-climbing.md)。


## 模型对照与下一步指导

现在姿态页可切换 MediaPipe Lite / Full / Heavy、RTMPose-s / m（26 点）、YOLO26n-pose（17 点）；岩点区可选择 FastSAM-s、MobileSAM、SAM2.1 Tiny。先勾选固定机位，暂停并点击目标做分割，人工确认后加入岩点标记。模型权重与校验记录见 `models/manifest.json`，模型测试结果见 [M2 实测报告](docs/model-benchmark-m2.md)。

“下一步指导”同时展示眼镜短句和网页详版。默认云模型为 JoyMaas `Qwen3.6-35B-A3B`，在项目 `.env` 填入 `CLIMBCUE_COACH_API_KEY` 后点“测试模型连接”，无需重启；未配置密钥时使用本地策略预览。大模型模式发送同帧原图、岩点编号图、人体姿态和知识片段，可编辑并保存个人指导提示词。短句与详版由同一动作生成；可导出眼镜指令 JSON，眼镜硬件尚未连接。实名认证后，文本、图片和真实网页快照复测通过：33 个关键点＋2 个 MobileSAM 岩点轮廓，单次指导约 2.45 秒。点击“截取瞬间并分析”会自动暂停并分析同一帧。详见 [真实调用报告](docs/joymaas-live-test-2026-10-17.md)。

[JoyMaas 核查、指导设计与配置](docs/joymaas-and-coach.md) · [实际指导提示词](docs/prompts/climbing-coach-v1.md)

```bash
npm run test:models
npm run test:coach
npm run test:coach-vision
.venv/bin/python scripts/benchmark-local-models.py
```

`uv sync` 默认仅安装基础依赖；之后需安装 `requirements-models.txt` 才能运行 Python 本地模型。没有这些可选依赖时，MediaPipe 和知识库仍可使用。模型测试会实际运行多个网络，耗时与当前系统负载有关。

### SAM 分割工作台

视频下方的 **SAM 岩点分割** 面板支持三模型切换、点击提示、FastSAM 整帧扫描、逐个勾选确认、保留岩点轮廓及 JSON 导出。确认后的轮廓参与手脚二维邻近计算；恢复播放会丢弃未确认候选及过期分割结果。使用方法、限制与实际验证见 [SAM 分割说明](docs/sam-segmentation.md)。运行 `npm run test:segmentation` 可复测三个真实模型。

批量标记流程：**批量选多个岩点 → 连续点击 → 分割所选点 → 检查候选 → 确认并播放监测**。每批最多 20 点，可追加多批；已确认轮廓在同一视频播放时保留，身体姿态与手脚二维邻近逐帧更新。支持选点撤销、候选全选及手动标记撤销，测试命令 `npm run test:multi-holds`。

### 颜色自动标记 + 手动修正

现在优先在视频上方选颜色或从画面取色，自动预选同色岩点；点击候选取消误选，手动补点/删点并支持撤销，最后确认并播放。SAM 工具折叠保留，用于精细补充。颜色重扫不覆盖已确认岩点及手动补点。操作与限制见 [颜色标记说明](docs/color-hold-marking.md)，验证命令 `npm run test:color-holds`。

标记入口已简化：加载视频后直接点击画面即可暂停并添加岩点；未勾选固定机位时也可编辑当前帧，停止后保留的画面同样可标记。只有携带标记播放监测需要勾选固定机位。回归命令：`npm run test:hold-selection`。


### 指导结果可视化

在姿态页点击“截取瞬间并分析”，结果区同时呈现 **同帧图片与关注位置、眼镜简略版、网页详细版**，可切换姿态/岩点叠加并查看模型耗时及返回数据。凭证已配置时默认使用大模型；也可选择本地预览。最新真实调用测试约 1.72 秒，桌面与手机布局均已检查，见 [指导设计与实测](docs/joymaas-and-coach.md)。
