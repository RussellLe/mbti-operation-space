"""
通用人脸检测脚本：对指定目录下所有 jpg/png 图片做人脸检测，
输出 JSON：{ "角色名": { "x_pct": ..., "y_pct": ... } }
表示人脸中心在原图中的百分比位置，可直接用作 CSS object-position。

用法：python3 detect-faces.py <图片目录路径>
"""
import cv2, json, sys, os

if len(sys.argv) < 2:
    print("用法: python3 detect-faces.py <图片目录路径>", file=sys.stderr)
    sys.exit(1)

IMG_DIR = sys.argv[1]

if not os.path.isdir(IMG_DIR):
    print(f"错误: 目录不存在: {IMG_DIR}", file=sys.stderr)
    sys.exit(1)

# OpenCV 自带的 Haar 级联：正脸 + 侧脸
cascades = [
    cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'),
    cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml'),
    cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml'),
]

SUPPORTED_EXT = ('.jpg', '.jpeg', '.png', '.webp')

results = {}

for fname in sorted(os.listdir(IMG_DIR)):
    ext = os.path.splitext(fname)[1].lower()
    if ext not in SUPPORTED_EXT:
        continue
    name = os.path.splitext(fname)[0]
    path = os.path.join(IMG_DIR, fname)
    img = cv2.imread(path)
    if img is None:
        print(f"  [WARN] {name}: 无法读取图片", file=sys.stderr)
        continue
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    all_faces = []
    for cascade in cascades:
        for sf in [1.1, 1.05]:
            for mn in [3, 2]:
                faces = cascade.detectMultiScale(gray, scaleFactor=sf, minNeighbors=mn, minSize=(w // 10, h // 10))
                if len(faces) > 0:
                    all_faces.extend(faces.tolist())
                # 同时尝试水平翻转（检测朝右的侧脸）
                flipped = cv2.flip(gray, 1)
                faces_f = cascade.detectMultiScale(flipped, scaleFactor=sf, minNeighbors=mn, minSize=(w // 10, h // 10))
                if len(faces_f) > 0:
                    for (fx, fy, fw, fh) in faces_f.tolist():
                        all_faces.append([w - fx - fw, fy, fw, fh])

    if len(all_faces) == 0:
        print(f"  [WARN] {name}: 未检测到人脸，使用默认 center 35%", file=sys.stderr)
        results[name] = {"x_pct": 50, "y_pct": 35}
        continue

    # 取最大的脸（面积最大）
    all_faces = sorted(all_faces, key=lambda f: f[2] * f[3], reverse=True)
    fx, fy, fw, fh = all_faces[0]
    cx = (fx + fw / 2) / w * 100
    cy = (fy + fh / 2) / h * 100

    results[name] = {"x_pct": round(cx, 1), "y_pct": round(cy, 1)}
    print(f"  {name}: face center = ({cx:.1f}%, {cy:.1f}%), size = {fw}x{fh}, detections = {len(all_faces)}", file=sys.stderr)

# 输出 JSON 到 stdout
print(json.dumps(results, ensure_ascii=False, indent=2))
