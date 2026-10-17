# M2 模型下载、实测与界面接入

日期：2026-10-17。Apple M2、8 CPU 核、16 GiB 内存、macOS 13.5。已下载并验证本轮选型中的全部可测候选：**6 种姿态选项、3 种分割选项**。另测试了两种人员检测器；自定义岩点 YOLO 尚无训练数据和权重，不列为已完成模型。

## 网页端实际处理帧率

Chrome 155 headless，实际视频解码、采样、推理、绘制和导出路径；两段项目视频，输入长边上限 960，目标上限 30 FPS。每个模型/视频预热 5 个结果后采集 30 个结果。短采样会受编译、系统负载和温度影响，不代表持续运行或实体摄像头成绩。

| 模型 | 原生点数 | 视频 1 FPS | 视频 2 FPS | 页面中的用途 |
| --- | --- | ---: | ---: | --- |
| MediaPipe Lite | 33 | 27.0 | 28.7 | 保留实时默认 |
| MediaPipe Full | 33 | 26.4 | 25.0 | 与 Lite 对照 |
| MediaPipe Heavy | 33 | 11.3 | 8.9 | 大模型对照，当前不作为实时默认 |
| RTMPose-s Halpe26 | 26 | 13.9 | 15.5 | 脚趾/脚跟观察，测试替代 ViTPose |
| RTMPose-m Halpe26 | 26 | 7.3 | 12.0 | 与 s 对照 |
| YOLO26n-pose | 17 | 16.9 | 20.0 | 轻量检测与姿态；缺少脚尖/脚跟 |

MediaPipe 使用浏览器 Worker CPU/WASM。YOLO 使用 MPS；RTMPose 使用 **YOLO26n-pose 的人员框（MPS）＋RTMPose ONNX CPU**。所有 Python 模型都经过 localhost JPEG 传输，因此不能只按网络推理用时倒数声称网页 FPS。

原始浏览器报告：`artifacts/browser-model-benchmark.json`；页面读取其副本 `web/static/browser-model-benchmark.json`。上一轮 Lite / Full 90 帧采样得到的 24–26 / 19–20 FPS 仍有效地反映测试波动，不能把本轮短采样解释为算法优化导致的稳定提升。

## 按需分割与接口耗时

与网页相同的 localhost 接口，按顺序解码两段视频后取样；3 次预热，姿态 30 帧、分割 6 帧。下表是包含预处理/网络/后处理的**推理耗时中位数**，不是整段视频追踪速度。

| 模型 | 视频 1 | 视频 2 | 实际模式 |
| --- | ---: | ---: | --- |
| RTMPose-s | 49.8 ms | 46.6 ms | YOLO26n-pose 检测＋ONNX 姿态 |
| RTMPose-m | 95.8 ms | 57.5 ms | 同上 |
| YOLO26n-pose | 26.8 ms | 21.0 ms | MPS，部分算子 CPU 回退 |
| FastSAM-s | 140.5 ms | 203.4 ms | MPS；点击筛选或整帧候选 |
| MobileSAM | 288.6 ms | 294.5 ms | MPS；点提示 |
| SAM2.1 Tiny | 799.1 ms | 743.7 ms | MPS＋CPU 算子回退；点提示 |

完整 P95、HTTP 耗时与输出数量保存在 `web/static/model-benchmark.json` 和 `artifacts/local-model-benchmark.json`。分割基准采用固定归一化点 (0.3,0.4)，仅用于通路和耗时测试，不保证每帧点击的都是岩点。FastSAM 在第二段固定提示点上有空结果；SAM2 也有空结果，因此“接口成功”不等于“岩点识别准确”。没有人工标注真值，尚未评估关键点误差、掩膜 IoU 或接触识别准确率。

## 实测发现与处理

- **YOLOX-tiny 漏检背身攀爬者**：不是只由解码问题导致。另试 YOLO26n 通用检测，示例人物得分约 0.089，仍低于 0.25 阈值；YOLO26n-pose 同帧人物框得分约 0.829。最终用姿态专用模型的人体框为 RTMPose 提供裁剪。这里没有声称这些分数是准确率。
- **不使用全图强行推姿态**：检测不到人就输出空观测。多人体逐帧选最大可见人体，没有跨帧身份保证；多人观测不用于生成换点动作。
- **SAM2.1 Tiny 的 CPU 可运行**。纯 MPS 在当前系统/PyTorch 上因 `upsample_bicubic2d` 不支持而失败；启用 `PYTORCH_ENABLE_MPS_FALLBACK=1` 后实测成功。它不是 Core ML 版本，绕过了原 Mac 示例的系统部署版本门槛。
- MPS 的 `nonzero` 等算子在 macOS 13.5 会 CPU 回退。GPU 可用与 GPU 上所有算子原生支持是两回事。应用默认选已测试的 MPS 路线，环境中设置 `CLIMBCUE_MODEL_DEVICE=cpu` 可做 CPU 对照。
- 第一版 OpenCV 随机跳帧在第二段视频有解码警告，最终接口报告改为连续解码后采样。旧随机跳帧结果不作为本表依据。

CPU/MPS 单图探测保存在 `artifacts/metal-benchmark.json`、`artifacts/metal-fallback-benchmark.json`。后者曾与页面功能测试并发，只用于兼容性确认；最终数值以上面的独立接口和浏览器报告为准。

## 界面与数据

- 姿态下拉框切换 6 种模型；切换会停止输入并清空本轮数据，需要重新选择输入。
- 岩点区选择分割模型，暂停后点击目标。FastSAM 另支持整帧候选。蓝色多边形仅表示物体候选，需人工确认后才作为岩点标记。
- 分割按需运行，不会每帧挤占姿态资源；没有实现 SAM 的视频掩膜传播。固定机位的候选可以保留；移动机位需另外做配准。
- 关键点明细按模型原生 33/26/17 点显示；JSON 同时保留原生输出与现有指标使用的 33 个语义槽位。不存在的点保留 `null`，不插值假造。CSV 的 `landmark_index` 继续使用项目语义槽位；原生索引见 JSON。
- RTMPose/YOLO 的置信度与 MediaPipe 可见度不是同一量纲，统一 0.5 仅为当前显示/指标门槛，未经攀岩数据校准。

## 可复现安装与验证

模型权重在 `models/local/`，MediaPipe 在 `web/static/models/`，均忽略 Git；来源、大小、SHA256 在 `models/manifest.json` 和 MediaPipe manifest 中。该 SHA256 是下载后固定的复现校验，不冒充发布方数字签名。辅助检测器权重保留用于复核失败案例。当前本地模型目录约 339 MB，MediaPipe 约 46 MB，虚拟环境约 953 MB。

```bash
uv sync
npm ci
npm run setup:pose
uv pip install --python .venv/bin/python -r requirements-models.txt
npm run setup:models
.venv/bin/python -m uvicorn web.app:app --host 127.0.0.1 --port 8000
# 另一个终端
.venv/bin/python -m pytest -q
npm test
npm run test:models
npm run test:coach
```

固定的主要依赖版本见 `requirements-models.txt`。第三方模型授权仍以各上游仓库/权重为准；此报告未改变其许可。

模型浏览器测试已验证两段视频/六种姿态、三种分割、原生点表、17 点足部缺失、导出、固定机位开关、候选确认和移动端无横向溢出。没有连接真实摄像头/眼镜做现场测试。
