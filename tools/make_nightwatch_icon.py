from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "nightwatch.ico"
PREVIEW = ROOT / "public" / "nightwatch-icon.png"


def make(size: int) -> Image.Image:
    scale = 4
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (1, 4, 3, 255))
    draw = ImageDraw.Draw(image)
    pad = 8 * scale
    draw.rounded_rectangle((pad, pad, canvas - pad, canvas - pad), radius=42 * scale, fill=(2, 10, 6, 255), outline=(16, 58, 38, 255), width=max(2, 5 * scale))

    points = [(22, 82), (78, 108), (108, 54), (128, 110), (148, 54), (178, 108), (234, 82), (210, 134), (234, 146), (186, 154), (164, 208), (128, 172), (92, 208), (70, 154), (22, 146), (46, 134)]
    points = [(int(x * scale), int(y * scale)) for x, y in points]
    glow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.polygon(points, fill=(32, 249, 134, 170))
    glow = glow.filter(ImageFilter.GaussianBlur(5 * scale))
    image.alpha_composite(glow)
    draw = ImageDraw.Draw(image)
    draw.polygon(points, fill=(32, 249, 134, 255))
    inner = [(87, 125), (105, 135), (128, 116), (151, 135), (169, 125), (158, 152), (128, 172), (98, 152)]
    draw.polygon([(int(x * scale), int(y * scale)) for x, y in inner], fill=(2, 16, 8, 185))
    eye = max(2, 5 * scale // 4)
    for x in (94, 162):
        cx, cy = x * scale, 142 * scale
        draw.ellipse((cx - eye, cy - eye, cx + eye, cy + eye), fill=(186, 255, 213, 255))
    draw.line((52 * scale, 222 * scale, 204 * scale, 222 * scale), fill=(32, 249, 134, 95), width=max(1, 4 * scale))
    return image.resize((size, size), Image.Resampling.LANCZOS)


sizes = [16, 24, 32, 48, 64, 128, 256]
images = [make(size) for size in sizes]
images[-1].save(OUT, format="ICO", sizes=[(s, s) for s in sizes])
images[-1].save(PREVIEW, format="PNG", optimize=True)
print(OUT)
print(PREVIEW)
