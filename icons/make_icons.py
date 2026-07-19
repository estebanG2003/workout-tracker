"""Generate the app icons: a blue rounded square with a white barbell glyph.
Run once (or after changing the design): python make_icons.py
"""
from PIL import Image, ImageDraw

BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)


def rounded(size, radius_frac, bg, margin_frac=0.0):
    """Blue rounded-square tile at `size`, optional margin (for maskable safe zone)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(size * margin_frac)
    r = int((size - 2 * m) * radius_frac)
    d.rounded_rectangle([m, m, size - m - 1, size - m - 1], radius=r, fill=bg)
    return img, d, m


def draw_barbell(d, size, m):
    """White barbell (bar + two end plates), centred in the tile."""
    inner = size - 2 * m
    cx = cy = size / 2
    bar_w = inner * 0.5
    bar_h = max(4, int(inner * 0.08))
    d.rounded_rectangle(
        [cx - bar_w / 2, cy - bar_h / 2, cx + bar_w / 2, cy + bar_h / 2],
        radius=bar_h / 2, fill=WHITE,
    )
    plate_w = max(6, int(inner * 0.13))
    plate_h = inner * 0.46
    for side in (-1, 1):
        px = cx + side * (bar_w / 2 + plate_w / 2 - inner * 0.02)
        d.rounded_rectangle(
            [px - plate_w / 2, cy - plate_h / 2, px + plate_w / 2, cy + plate_h / 2],
            radius=plate_w * 0.35, fill=WHITE,
        )


def make(path, size, margin_frac=0.0, radius_frac=0.22):
    img, d, m = rounded(size, radius_frac, BLUE, margin_frac)
    draw_barbell(d, size, m)
    img.save(path)
    print("wrote", path)


if __name__ == "__main__":
    make("icon-192.png", 192)
    make("icon-512.png", 512)
    make("icon-180.png", 180)                         # apple-touch (no transparency needed)
    # maskable: keep art inside the ~80% safe zone -> add margin
    make("icon-maskable-512.png", 512, margin_frac=0.14, radius_frac=0.30)
