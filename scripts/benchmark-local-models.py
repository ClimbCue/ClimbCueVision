"""Benchmark the same localhost endpoint as the browser. No quality claims."""
import argparse
import json
from pathlib import Path
import time
import cv2
import httpx
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:8000')
args=parser.parse_args()
client=httpx.Client(base_url=args.url,timeout=150,trust_env=False)
catalog=client.get('/api/models').json()['models']
report={'machine':'Apple M2 / 16 GiB / macOS 13.5','date':'2026-10-17','scope':'Localhost JPEG endpoint; two clips decoded sequentially, 3 warmups, pose 30 frames and segmentation 6 frames per clip. Latency includes preprocessing, model and postprocessing; HTTP wall time separately. No annotated accuracy.','runs':[]}
for m in catalog:
    for index,path in enumerate(sorted((ROOT/'testvideos').glob('*.mp4')),1):
        run={'model':m['id'],'video':index,'ok':False}
        try:
            start=time.perf_counter();response=client.post(f"/api/models/{m['id']}/load");response.raise_for_status()
            run['load_ms']=(time.perf_counter()-start)*1000
            cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS);total=cap.get(cv2.CAP_PROP_FRAME_COUNT)
            times=[];wall=[];counts=[];count=30 if m['kind']=='pose' else 6
            current=-1
            for i in range(count+3):
                frame_number=min(int((1+i*.25)*fps),max(0,int(total)-1))
                while current<frame_number:
                    ok,frame=cap.read();assert ok
                    current+=1
                scale=min(1,960/max(frame.shape[:2]));frame=cv2.resize(frame,(round(frame.shape[1]*scale),round(frame.shape[0]*scale)))
                ok,jpeg=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,90]);assert ok
                suffix='?x=0.3&y=0.4' if m['kind']=='segment' else ''
                start=time.perf_counter();response=client.post(f"/api/models/{m['id']}/infer{suffix}",content=jpeg.tobytes(),headers={'Content-Type':'image/jpeg'})
                response.raise_for_status();data=response.json();elapsed=(time.perf_counter()-start)*1000
                if i>=3:
                    times.append(data['inference_ms']);wall.append(elapsed)
                    counts.append(len(data.get('native_landmarks',data.get('polygons',[]))))
                if i==3:(ROOT/f"artifacts/{m['id']}-video{index}.json").write_text(json.dumps(data))
            cap.release()
            run.update(ok=True,runtime=data['runtime'],samples=count,p50_ms=round(float(np.median(times)),2),p95_ms=round(float(np.percentile(times,95)),2),http_p50_ms=round(float(np.median(wall)),2),http_p95_ms=round(float(np.percentile(wall,95)),2),output_count_median=float(np.median(counts)))
        except Exception as e:run['error']=str(e)
        report['runs'].append(run)
        print(json.dumps(run),flush=True)
        (ROOT/'web/static/model-benchmark.json').write_text(json.dumps(report,indent=2))
(ROOT/'artifacts/local-model-benchmark.json').write_text(json.dumps(report,indent=2))
