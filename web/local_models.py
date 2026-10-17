"""Optional localhost pose and prompted segmentation adapters. No runtime downloads."""
import gc
import importlib.util
import os
from pathlib import Path
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = ROOT / 'models/local'
os.environ.setdefault('YOLO_CONFIG_DIR', str(ROOT / 'web/runtime/ultralytics'))
os.environ.setdefault('MPLCONFIGDIR', str(ROOT / 'web/runtime/matplotlib'))
os.environ.setdefault('YOLO_AUTOINSTALL', 'false')
os.environ.setdefault('YOLO_OFFLINE', 'true')
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
REGISTRY = {
    'rtmpose-s': dict(label='RTMPose-s · 26 点', kind='pose', file='rtmpose-s.onnx', count=26, runtime='ONNX Runtime CPU'),
    'rtmpose-m': dict(label='RTMPose-m · 26 点', kind='pose', file='rtmpose-m.onnx', count=26, runtime='ONNX Runtime CPU'),
    'yolo26n-pose': dict(label='YOLO26n-pose · 17 点', kind='pose', file='yolo26n-pose.pt', count=17, runtime='PyTorch 自动 MPS / CPU'),
    'fastsam-s': dict(label='FastSAM-s · 候选分割', kind='segment', file='FastSAM-s.pt', runtime='PyTorch 自动 MPS / CPU', prompt=False),
    'mobilesam': dict(label='MobileSAM · 点击分割', kind='segment', file='mobile_sam.pt', runtime='PyTorch 自动 MPS / CPU', prompt=True),
    'sam2.1-tiny': dict(label='SAM2.1 Tiny · 点击分割', kind='segment', file='sam2.1_t.pt', runtime='PyTorch 自动 MPS / CPU', prompt=True),
}
COCO_NAMES = ['鼻尖','左眼','右眼','左耳','右耳','左肩','右肩','左肘','右肘','左腕','右腕','左髋','右髋','左膝','右膝','左踝','右踝']
HALPE_NAMES = COCO_NAMES + ['头顶','颈部','髋中点','左大脚趾','右大脚趾','左小脚趾','右小脚趾','左脚跟','右脚跟']
# Model keypoint index -> existing semantic slots. Missing slots stay null.
COCO_MAP = [0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28]


def mask_polygons(masks, frame_shape, limit=100):
    """Keep disconnected components separate; xyn merges them with artificial bridges.

    External contours approximate binary masks. Interior holes are not represented.
    scale_coords removes any letterbox padding before normalization.
    """
    import cv2
    import numpy as np
    from ultralytics.utils.ops import scale_coords
    polygons=[]
    for mask in masks.data.cpu().numpy():
        contours,_=cv2.findContours((mask>0.5).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours,key=cv2.contourArea,reverse=True):
            if cv2.contourArea(contour)<1:
                continue
            points=scale_coords(mask.shape,contour.reshape(-1,2).astype(np.float32),frame_shape,normalize=True)
            points=cv2.approxPolyDP(points,.002,True).reshape(-1,2)
            if len(points)>=3:
                polygons.append(np.clip(points,0,1).tolist())
                if len(polygons)>=limit:
                    return polygons
    return polygons


def adapt_landmarks(xy, scores, width, height):
    native = [dict(x=float(p[0])/width, y=float(p[1])/height, visibility=float(s)) for p,s in zip(xy,scores)]
    mapped = [None]*33
    for i, slot in enumerate(COCO_MAP):
        mapped[slot] = native[i]
    if len(native) == 26:
        for i, slot in [(20,31),(21,32),(24,29),(25,30)]:
            mapped[slot] = native[i]
    return mapped, native


def catalog():
    items = []
    for ident, spec in REGISTRY.items():
        dep = 'rtmlib' if ident.startswith('rtmpose') else 'ultralytics'
        available = (WEIGHTS/spec['file']).is_file() and importlib.util.find_spec(dep) is not None
        if ident.startswith('rtmpose'):
            available = available and (WEIGHTS/'yolo26n-pose.pt').is_file() and importlib.util.find_spec('ultralytics') is not None
        items.append(dict(id=ident, **spec, available=available, reason='' if available else '缺少权重或本地推理依赖'))
    return items


class ModelManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.models = {}
        self.devices = {}
        self.detector = None
        self.detector_device = 'cpu'

    def load(self, ident):
        if ident not in REGISTRY:
            raise ValueError('未知模型')
        spec = REGISTRY[ident]
        if not (WEIGHTS/spec['file']).is_file():
            raise ValueError('模型权重缺失，请运行下载脚本')
        # One model per task keeps RAM bounded when switching.
        if ident not in self.models:
            for key in list(self.models):
                if REGISTRY[key]['kind'] == spec['kind']:
                    del self.models[key]
                    self.devices.pop(key,None)
            gc.collect()
            import torch
            torch.set_num_threads(4)
            device = 'mps' if torch.backends.mps.is_available() and os.getenv('CLIMBCUE_MODEL_DEVICE','auto')!='cpu' else 'cpu'
            from ultralytics import YOLO, SAM, FastSAM, settings
            settings.update({'sync':False})
            if ident.startswith('rtmpose'):
                from rtmlib import RTMPose
                if self.detector is None:
                    if not (WEIGHTS/'yolo26n-pose.pt').is_file():raise ValueError('人员检测器权重缺失')
                    self.detector = YOLO(str(WEIGHTS/'yolo26n-pose.pt'))
                    self.detector_device = device
                model = RTMPose(str(WEIGHTS/spec['file']), model_input_size=(192,256),
                             backend='onnxruntime', device='cpu', to_openpose=False)
            else:
                if torch.backends.mps.is_available():
                    torch.mps.empty_cache()
                cls = YOLO if spec['kind']=='pose' else FastSAM if ident=='fastsam-s' else SAM
                model = cls(str(WEIGHTS/spec['file']))
                self.devices[ident] = device
            self.models[ident] = model
        return self.models[ident]

    def infer(self, ident, frame, point=None):
        import numpy as np
        spec = REGISTRY[ident]
        model = self.load(ident)
        device = self.devices.get(ident,'cpu')
        start = time.perf_counter()
        h,w = frame.shape[:2]
        if spec['kind'] == 'pose':
            if ident.startswith('rtmpose'):
                detection = self.detector.predict(frame,device=self.detector_device,imgsz=640,classes=[0],conf=.25,verbose=False,save=False)[0]
                detections=detection.boxes.xyxy.cpu().numpy()
                boxes = detections.tolist()
                if len(detections):
                    xy, scores = model(frame,bboxes=detections)
                else:
                    xy,scores=np.empty((0,26,2)),np.empty((0,26))
            else:
                result = model.predict(frame, device=device, imgsz=640, verbose=False, save=False)[0]
                xy = result.keypoints.xy.cpu().numpy()
                scores = result.keypoints.conf.cpu().numpy() if result.keypoints.conf is not None else np.empty((0,17))
                boxes = result.boxes.xyxy.cpu().numpy().tolist()
            # Stateless largest-person selection, explicitly not identity tracking.
            chosen = None
            if len(xy):
                areas=[]
                for pts, conf in zip(xy,scores):
                    valid=pts[np.asarray(conf)>=.3]
                    areas.append(float(np.prod(np.ptp(valid,axis=0))) if len(valid)>1 else 0)
                chosen=int(np.argmax(areas))
                mapped,native = adapt_landmarks(xy[chosen],scores[chosen],w,h)
            else:
                mapped,native=[],[]
            data=dict(landmarks=mapped,native_landmarks=native,names=HALPE_NAMES if spec['count']==26 else COCO_NAMES,
                      keypoint_count=spec['count'],people=len(xy),selected_person=chosen,boxes=boxes,
                      selection='largest visible person per frame; no persistent identity',schema='halpe26' if spec['count']==26 else 'coco17')
        else:
            if spec['prompt'] and point is None:
                raise ValueError('此模型需要在画面上点击目标')
            kwargs = dict(device=device, imgsz=640 if ident=='fastsam-s' else 1024, verbose=False, save=False)
            if point is not None:
                kwargs.update(points=[[point[0]*w,point[1]*h]], labels=[1])
            if ident=='fastsam-s':
                kwargs.update(conf=.25,iou=.7,retina_masks=True)
            result = model.predict(frame, **kwargs)[0]
            polygons=mask_polygons(result.masks,frame.shape) if result.masks is not None else []
            data=dict(polygons=polygons,point=point,task='prompted_image_segmentation' if point else 'candidate_image_segmentation',
                      warning='候选物体掩膜，不是已确认岩点；没有视频传播或真实接触判断')
        runtime = f'YOLO26n-pose 检测 {self.detector_device.upper()} + RTMPose ONNX CPU' if ident.startswith('rtmpose') else 'PyTorch MPS / CPU 算子回退' if device=='mps' else 'PyTorch CPU'
        return dict(data, model=ident, runtime=runtime, inference_ms=(time.perf_counter()-start)*1000,
                    width=w,height=h)


manager = ModelManager()
