"""Generate the DevKit icon set (no network, uses Pillow)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
os.makedirs(OUT, exist_ok=True)

BASE = 512
img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, BASE, BASE], radius=112, fill=(39, 131, 222, 255))
# angle-bracket + slash mark: < / >
d.line([(150, 190), (95, 256), (150, 322)], fill=(255, 255, 255, 255), width=26, joint="curve")
d.line([(362, 190), (417, 256), (362, 322)], fill=(255, 255, 255, 255), width=26, joint="curve")
d.line([(285, 160), (227, 352)], fill=(229, 242, 252, 255), width=24)

for size in (16, 32, 48, 128, 256):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"icon-{size}.png"))
print("icons written to", os.path.abspath(OUT))
