"""아이콘 만들기: assets/icon-source.jpg(소유자가 준 그림) → 바깥 흰 배경을 투명하게 → nongmak.ico(16~256) + 화면용 PNG.
빌드 때 한 번(Pillow 필요, 개발 서버에서만)."""
import sys
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
src = Image.open(ROOT / "assets/icon-source.jpg").convert("RGBA")
w, h = src.size
px = src.load()
# 가장자리에서 이어진 흰색(JPEG 얼룩 고려해 밝기 235 이상)만 투명하게 - 그림 안의 흰 종이·얼굴은 검은 테두리에 막혀 남는다
seen, queue = set(), deque((x, y) for x in range(w) for y in (0, h - 1)) + deque((x, y) for y in range(h) for x in (0, w - 1))
while queue:
    x, y = queue.popleft()
    if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
        continue
    seen.add((x, y))
    r, g, b, _ = px[x, y]
    if min(r, g, b) < 235:
        continue
    px[x, y] = (255, 255, 255, 0)
    queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
box = src.getbbox()
art = src.crop(box)
side = max(art.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
out = ROOT / "assets"
square.resize((256, 256), Image.LANCZOS).save(out / "nongmak.ico", sizes=[(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])
square.resize((64, 64), Image.LANCZOS).save(out / "icon-64.png", optimize=True)
square.resize((192, 192), Image.LANCZOS).save(out / "icon-192.png", optimize=True)
print("ok", square.size, (out / "nongmak.ico").stat().st_size, "bytes")
