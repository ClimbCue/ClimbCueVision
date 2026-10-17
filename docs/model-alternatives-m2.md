# M2 上的 ViTPose+ Large / SAM3.1 替代候选

调研日期：2026-10-17。当前设备：Apple M2、16 GiB 统一内存、8 核 CPU、macOS 13.5。

**更新：已完成模型下载、实测和页面接入，当前结果以 [M2 实测报告](model-benchmark-m2.md) 为准。以下保留选型时的判断。**

原调研结论：优先评测 **RTMPose-s（Halpe26）+ FastSAM-s**。前者替代姿态提取，后者用于岩点候选分割。它们是适合本机资源规模的候选，还没有在本机安装、跑通或测量，不能据此承诺实时帧率、攀岩精度或完整替代 SAM3.1。

## 姿态候选

| 模型 | 本地部署路线 | 与攀岩需求的关系 | 建议 |
| --- | --- | --- | --- |
| RTMPose-s Halpe26 | 官方 ONNX 权重，先测 ONNX Runtime CPU；后续评估 Core ML EP | 26 点，包括双侧大脚趾、小脚趾和脚跟；适合保留足部分析 | 第一候选；256×192、约 5.70M 参数 |
| RTMPose-m Halpe26 | 同上 | 同一关键点定义，可用相同视频与 s 对照 | 约 13.93M 参数，作为质量对照；不能预设攀岩更准 |
| YOLO26n-pose | Python/ONNX；支持导出 Core ML，部署目标需核对 | 一次网络推理输出人员框和姿态，接入较直接；默认 17 点不含脚趾、脚跟 | 适合主要观察躯干、肘膝；不能无损替换当前足部指标 |
| MediaPipe Pose Lite / Full | 已接入网页 Worker CPU/WASM | 33 点，现有数据与指标可继续使用 | 保留作本机实时基线 |

RTMPose 是 top-down 模型，还要人员检测/裁剪及目标关联；不能把单个姿态网络的耗时当作整条视频链路的耗时。先使用轻量检测器，跟踪稳定时降低检测频率，再测完整处理帧率。26 点/17 点都需新的关键点适配，不能直接套用当前 33 点数组索引。

来源：[RTMPose 官方模型与 ONNX 下载](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose#26-keypoints)、[Halpe26 关键点定义](https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/halpe26.py)、[YOLO 姿态与导出支持](https://docs.ultralytics.com/tasks/pose/)、[ONNX Runtime Core ML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)。Core ML EP 只代表一条可选执行路径，模型算子覆盖、CPU 回退和实际加速收益仍需测试。

## 岩点分割候选

| 模型 | 本地部署路线 | 能替代的部分 | 主要限制 |
| --- | --- | --- | --- |
| FastSAM-s | 先测兼容 macOS 13.5 的 Python CPU 环境，再评估 ONNX 导出 | 生成候选物体掩膜，通过点/框筛选 | 约 11.8M 参数、23.9 MB 权重；小岩点漏检、边界、遮挡需验证，不自动保证识别“所有岩点” |
| MobileSAM | PyTorch CPU；缓存图像编码后交互选点 | 点击/框选单个岩点，辅助人工修正 | 约 10.1M 参数；轻量不等于逐帧实时，不作为首选视频方案 |
| SAM2.1 Tiny Core ML | Apple 账号提供转换权重，配套 Mac 示例 | 点/框提示的图像分割 | 当前 macOS 13.5 不满足现成示例的 14.3 部署目标；先解决版本兼容再评测 |
| 自定义 YOLO26n-seg 岩点模型 | 标注岩点数据并训练，导出 ONNX/Core ML | 针对岩点类别的自动分割 | 通用预训练权重没有攀岩岩点类别；需要训练与独立测试集 |

来源：[FastSAM 文档](https://docs.ultralytics.com/models/fast-sam/)、[MobileSAM 作者仓库](https://github.com/ChaoningZhang/MobileSAM)、[Apple SAM2.1 Tiny Core ML 权重](https://huggingface.co/apple/coreml-sam2.1-tiny)、[YOLO 实例分割](https://docs.ultralytics.com/tasks/segment/)。FastSAM 文档里的 Apple M4 测试不是本机 M2 实测，不能照搬帧率；依赖也需选择支持当前系统的版本。

SAM2 Core ML 转换分支明确说明目前转换的是**图像分割**，视频支持仍在开发；不能把原始 PyTorch SAM2 的视频传播能力当成该 Core ML 包已有的能力。SAM2 点/框提示、FastSAM 候选筛选，也不等于 SAM3.1 的语义提示与整段视频追踪能力。

系统限制的依据：配套 [SAM2 Studio 工程](https://github.com/huggingface/sam2-studio/blob/main/SAM2-Demo.xcodeproj/project.pbxproj) 的 `MACOSX_DEPLOYMENT_TARGET = 14.3`；[转换脚本](https://github.com/huggingface/segment-anything-2/blob/coreml-conversion/coreml/export.py) 默认 `iOS17` 目标，对应 macOS 14。是否可改为较低目标重新转换需要验证，不能只改数字就认为兼容。上述示例要求不代表 M2 硬件无法运行 SAM2。

## 项目接入与验证顺序

1. 保留现有 `/pose` 的 MediaPipe Lite。已有两段视频实测为 24.31 / 26.30 FPS，Full 为 19.82 / 18.87 FPS；条件见 [本地模型与指标报告](local-models-and-climbing.md)。
2. 新模型先走本机 Python 服务，使用相同两段视频测 RTMPose-s Halpe26 与 FastSAM-s；记录初始化、端到端 P50/P95、实际 FPS、峰值内存及算子回退。模型导出成功不算运行验证。
3. 固定机位先分割无人物遮挡的墙面，在画面中确认岩点候选，缓存掩膜。姿态高频更新，岩点在用户要求或画面变化时更新；移动机位还需配准/追踪。
4. 核验背身、交叉四肢、遮挡、脚尖、较小岩点和不同颜色；用人工标注评估关键点误差、掩膜 IoU 与接触事件，不能只比较置信度。

当前阶段仅完成候选及部署条件调研，没有把新模型接入项目。二维髋中心/肩髋几何中心仍是观察代理，不会因替换模型自动成为真实身体重心；画面邻近也不自动证明手脚接触或承重。
