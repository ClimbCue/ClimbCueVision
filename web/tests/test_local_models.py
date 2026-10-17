from io import BytesIO
import threading

import pytest
from fastapi.testclient import TestClient

from web.app import create_app
from web.local_models import adapt_landmarks, manager


def test_coco_mapping_preserves_missing_feet():
    xy=[[i*2,i*3] for i in range(17)]
    mapped,native=adapt_landmarks(xy,[.8]*17,100,200)
    assert mapped[11] == native[5]
    assert mapped[27] == native[15]
    assert mapped[29] is None and mapped[31] is None
    assert len(native)==17


def test_halpe_mapping_uses_toes_and_heels():
    mapped,native=adapt_landmarks([[i,i] for i in range(26)],[.9]*26,100,100)
    assert mapped[31] == native[20]
    assert mapped[29] == native[24]
    assert mapped[19] is None  # No invented fingers


def test_local_api_validation(tmp_path,monkeypatch):
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        assert client.post('/api/models/unknown/load').status_code==404
        assert client.post('/api/models/rtmpose-s/infer?x=2&y=0').status_code==422
        assert client.post('/api/models/rtmpose-s/infer',content=b'x').status_code==422
        assert client.post('/api/models/rtmpose-s/infer',content=b'x'*2_000_001).status_code==413
        assert client.post('/api/models/rtmpose-s/load',headers={'origin':'https://other.test'}).status_code==403
        Image=pytest.importorskip('PIL.Image')
        out=BytesIO();Image.new('RGB',(32,32)).save(out,format='JPEG')
        lock=threading.Lock();monkeypatch.setattr(manager,'lock',lock)
        lock.acquire()
        try:
            assert client.post('/api/models/rtmpose-s/infer',content=out.getvalue()).status_code==409
        finally:lock.release()


def test_mask_components_do_not_bridge_empty_wall():
    np=pytest.importorskip('numpy')
    torch=pytest.importorskip('torch')
    pytest.importorskip('ultralytics')
    from types import SimpleNamespace
    from web.local_models import mask_polygons
    mask=np.zeros((1,100,100),dtype=np.float32)
    mask[0,10:30,10:30]=1
    mask[0,60:80,60:80]=1
    polygons=mask_polygons(SimpleNamespace(data=torch.from_numpy(mask)),(100,100,3))
    assert len(polygons)==2
    for polygon in polygons:
        a=np.asarray(polygon)
        assert np.ptp(a[:,0])<.21 and np.ptp(a[:,1])<.21
    assert len(mask_polygons(SimpleNamespace(data=torch.from_numpy(mask)),(100,100,3),limit=1))==1


def test_mask_contour_removes_letterbox_padding():
    np=pytest.importorskip('numpy')
    torch=pytest.importorskip('torch')
    pytest.importorskip('ultralytics')
    from types import SimpleNamespace
    from web.local_models import mask_polygons
    mask=np.zeros((1,100,100),dtype=np.float32)
    mask[0,30:50,20:40]=1  # Original 100x50 image padded by 25 pixels above/below.
    polygon=np.asarray(mask_polygons(SimpleNamespace(data=torch.from_numpy(mask)),(50,100,3))[0])
    assert polygon[:,0].min()==pytest.approx(.2)
    assert polygon[:,1].min()==pytest.approx(.1)
