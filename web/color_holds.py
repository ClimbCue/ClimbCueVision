"""Local color-region proposals, not a semantic climbing-hold detector."""
import time


def color_regions(frame, colors, tolerance=12, min_area=.0004, max_area=.10):
    import cv2
    import numpy as np
    start = time.perf_counter()
    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.int16)
    mask = np.zeros((h, w), dtype=np.uint8)
    for color in colors:
        rgb = [int(color[i:i+2], 16) for i in (0, 2, 4)]
        target = cv2.cvtColor(np.uint8([[rgb[::-1]]]), cv2.COLOR_BGR2HSV)[0, 0]
        hue, sat, value = map(int, target)
        if sat < 45:
            # Hue is undefined for neutral colors. Separate white, gray and black.
            if value > 190:
                match = (hsv[:, :, 1] < 65) & (hsv[:, :, 2] > 165)
            elif value < 90:
                match = hsv[:, :, 2] < 85
            else:
                match = (hsv[:, :, 1] < 65) & (abs(hsv[:, :, 2]-value) < 45)
        else:
            delta = abs(hsv[:, :, 0]-hue)
            delta = np.minimum(delta, 180-delta)  # Red spans the HSV hue seam.
            match = (delta <= tolerance) & (hsv[:, :, 1] >= max(45, sat*.25)) & (hsv[:, :, 2] >= 30)
        mask[match] = 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)/(w*h)
        if not min_area <= area <= max_area:
            continue
        points = contour.reshape(-1, 2).astype(np.float32)/np.array([w, h], dtype=np.float32)
        points = cv2.approxPolyDP(points, .0015, True).reshape(-1, 2)
        if len(points) >= 3:
            polygons.append(points.tolist())
    return dict(model='color-hsv', runtime='本机 OpenCV / CPU', task='color_region_candidates',
                polygons=polygons[:100], truncated=len(polygons)>100, colors=['#'+c for c in colors],
                tolerance=tolerance, min_area=min_area, max_area=max_area, width=w, height=h,
                inference_ms=(time.perf_counter()-start)*1000,
                warning='同色区域候选，可能包含衣物或背景；多色岩点可能只覆盖部分表面，外轮廓不表达内部孔洞。')
