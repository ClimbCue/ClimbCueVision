from io import BytesIO
import pytest
np=pytest.importorskip('numpy')
cv2=pytest.importorskip('cv2')
Image=pytest.importorskip('PIL.Image')
from fastapi.testclient import TestClient
from web.app import create_app
from web.color_holds import color_regions


def scene():
    frame=np.full((200,300,3),160,dtype=np.uint8)
    cv2.circle(frame,(60,60),14,(0,0,220),-1)
    cv2.circle(frame,(170,100),12,(0,0,100),-1)  # Same hue in shadow.
    cv2.circle(frame,(240,55),13,(220,40,10),-1)
    frame[180,20]=(0,0,255)  # Isolated noise.
    return frame


def test_color_regions_match_shadows_ignore_noise_and_keep_components():
    result=color_regions(scene(),['ff0000'])
    assert len(result['polygons'])==2
    for p in result['polygons']:
        a=np.array(p)
        assert np.ptp(a[:,0])<.11 and np.ptp(a[:,1])<.16
        assert ((a>=0)&(a<=1)).all()
    assert result['model']=='color-hsv'


def test_multiple_colors_include_blue_without_merging_distinct_holds():
    assert len(color_regions(scene(),['ff0000','0040ff'])['polygons'])==3


def test_red_hue_wrap_and_large_background_rejection():
    hsv=np.zeros((120,160,3),dtype=np.uint8);hsv[:]=(90,0,160)
    hsv[20:40,20:40]=(179,240,210);hsv[60:80,100:120]=(1,240,210)
    assert len(color_regions(cv2.cvtColor(hsv,cv2.COLOR_HSV2BGR),['ff0000'])['polygons'])==2
    frame=np.zeros((100,100,3),dtype=np.uint8);frame[:]=(0,0,220)
    assert color_regions(frame,['ff0000'])['polygons']==[]


def test_neutral_color_uses_brightness_instead_of_arbitrary_hue():
    frame=np.full((150,150,3),130,dtype=np.uint8)
    cv2.circle(frame,(30,40),10,(230,230,230),-1)
    cv2.circle(frame,(100,90),10,(25,25,25),-1)
    assert len(color_regions(frame,['eeeeee'])['polygons'])==1
    assert len(color_regions(frame,['222222'])['polygons'])==1


def test_color_api_validation_and_actual_image(tmp_path):
    out=BytesIO();Image.fromarray(cv2.cvtColor(scene(),cv2.COLOR_BGR2RGB)).save(out,format='PNG')
    with TestClient(create_app(tmp_path/'kb.db')) as client:
        r=client.post('/api/holds/color?colors=ff0000',content=out.getvalue())
        assert r.status_code==200 and len(r.json()['polygons'])==2
        for query in ['colors=garbage','colors=ff0000&tolerance=90','colors=ff0000&min_area=nan','colors=ff0000&min_area=-1','colors='+','.join(['ff0000']*9)]:
            assert client.post('/api/holds/color?'+query,content=out.getvalue()).status_code==422
        assert client.post('/api/holds/color?colors=ff0000',content=b'bad').status_code==422
        assert client.post('/api/holds/color?colors=ff0000',content=b'x'*2_000_001).status_code==413
        assert client.post('/api/holds/color?colors=ff0000',content=out.getvalue(),headers={'Origin':'https://other.test'}).status_code==403
