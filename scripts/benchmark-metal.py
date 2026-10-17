"""Probe actual MPS operators and compare warm per-image latency (not video FPS)."""
import gc
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from web.local_models import REGISTRY, WEIGHTS
import cv2
import numpy as np
import torch
from ultralytics import YOLO, SAM, FastSAM
torch.set_num_threads(4)
frame=cv2.imread(str(ROOT/'artifacts/model-test-frame.jpg'))
report={'available':torch.backends.mps.is_available(),'runs':[]}
for ident in (sys.argv[1:] or ['yolo26n-pose','fastsam-s','mobilesam','sam2.1-tiny']):
    spec=REGISTRY[ident]
    cls=YOLO if spec['kind']=='pose' else FastSAM if ident=='fastsam-s' else SAM
    for device in ['cpu','mps']:
        run={'model':ident,'device':device,'ok':False}
        model=None
        try:
            model=cls(str(WEIGHTS/spec['file']))
            kwargs=dict(device=device,verbose=False,save=False,imgsz=640 if ident in ['fastsam-s','yolo26n-pose'] else 1024)
            if spec['kind']=='segment':kwargs.update(points=[[.3*frame.shape[1],.4*frame.shape[0]]],labels=[1])
            if ident=='fastsam-s':kwargs.update(conf=.25,iou=.7,retina_masks=True)
            times=[]
            for i in range(9):
                start=time.perf_counter();result=model.predict(frame,**kwargs)[0]
                if device=='mps':torch.mps.synchronize()
                if i>=3:times.append((time.perf_counter()-start)*1000)
            run.update(ok=True,p50_ms=float(np.median(times)),p95_ms=float(np.percentile(times,95)),samples=len(times))
        except Exception as e:run['error']=str(e)
        report['runs'].append(run);print(json.dumps(run),flush=True)
        (ROOT/('artifacts/metal-fallback-benchmark.json' if sys.argv[1:] else 'artifacts/metal-benchmark.json')).write_text(json.dumps(report,indent=2))
        del model;gc.collect()
        if torch.backends.mps.is_available():torch.mps.empty_cache()
