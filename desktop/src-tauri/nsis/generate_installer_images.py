#!/usr/bin/env python3
"""Generate NSIS installer branding images for JAcoworks."""

from PIL import Image, ImageDraw, ImageFont
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_PATH = os.path.join(SCRIPT_DIR, "..", "icons", "icon.png")

# Brand colors
TERRACOTTA = (196, 114, 74)
CREAM = (245, 240, 235)
DARK_BROWN = (60, 45, 35)
WARM_WHITE = (255, 252, 248)
TERRACOTTA_LIGHT = (220, 170, 140)
TERRACOTTA_DARK = (146, 78, 45)
TERRACOTTA_MID = (176, 100, 62)

# Fonts (macOS)
FONT_EN = "/System/Library/Fonts/Helvetica.ttc"
FONT_CN = "/System/Library/Fonts/STHeiti Medium.ttc"


def load_font(path, size, fallback_path=None):
    try:
        return ImageFont.truetype(path, size)
    except (OSError, IOError):
        if fallback_path:
            try:
                return ImageFont.truetype(fallback_path, size)
            except (OSError, IOError):
                pass
    return ImageFont.load_default()


def gradient_fill(draw, rect, start_color, end_color, direction="vertical"):
    x0, y0, x1, y1 = rect
    steps = (y1 - y0) if direction == "vertical" else (x1 - x0)
    for i in range(steps):
        ratio = i / max(1, steps - 1)
        # Smooth easing
        ratio = ratio * ratio * (3 - 2 * ratio)
        c = tuple(int(start_color[k] + (end_color[k] - start_color[k]) * ratio) for k in range(3))
        if direction == "vertical":
            draw.line([(x0, y0 + i), (x1, y0 + i)], fill=c)
        else:
            draw.line([(x0 + i, y0), (x0 + i, y1)], fill=c)


def draw_decorative_dots(draw, x0, y0, cols, rows, spacing, base_color, bg_color):
    """Draw a grid of subtle decorative dots."""
    for i in range(cols):
        for j in range(rows):
            x = x0 + i * spacing
            y = y0 + j * spacing
            alpha = 0.15 + (j * 0.08) + (i % 2) * 0.05
            alpha = min(alpha, 0.5)
            c = tuple(int(base_color[k] * alpha + bg_color[k] * (1 - alpha)) for k in range(3))
            draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=c)


def create_sidebar_image():
    """Create 164x314 sidebar BMP for NSIS welcome/finish pages."""
    W, H = 164, 314
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    # Rich gradient background
    gradient_fill(draw, (0, 0, W, H), TERRACOTTA_DARK, TERRACOTTA)

    # Load and paste the actual app icon (resized)
    try:
        icon = Image.open(ICON_PATH).convert("RGBA")
        icon_size = 72
        icon = icon.resize((icon_size, icon_size), Image.LANCZOS)

        # Create circular mask
        mask = Image.new("L", (icon_size, icon_size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.ellipse([0, 0, icon_size, icon_size], fill=255)

        # Paste icon centered at top
        ix = (W - icon_size) // 2
        iy = 45
        # Create a temp RGB image for compositing onto non-RGBA background
        icon_rgb = Image.new("RGB", (icon_size, icon_size), TERRACOTTA_DARK)
        icon_rgb.paste(icon, mask=icon.split()[3])  # use alpha as mask
        img.paste(icon_rgb, (ix, iy), mask)
    except (OSError, IOError) as e:
        print(f"Warning: Could not load icon: {e}")
        # Fallback: draw circle placeholder
        draw.ellipse([46, 45, 118, 117], outline=WARM_WHITE, width=2)

    # Brand name
    font_name = load_font(FONT_EN, 18)
    font_cn = load_font(FONT_CN, 11, FONT_EN)
    font_ver = load_font(FONT_EN, 9)

    # "JAcoworks"
    text = "JAcoworks"
    bbox = draw.textbbox((0, 0), text, font=font_name)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, 135), text, fill=WARM_WHITE, font=font_name)

    # Chinese subtitle
    subtitle = "企业 AI 协同办公平台"
    bbox2 = draw.textbbox((0, 0), subtitle, font=font_cn)
    tw2 = bbox2[2] - bbox2[0]
    draw.text(((W - tw2) // 2, 162), subtitle, fill=TERRACOTTA_LIGHT, font=font_cn)

    # Separator line
    line_y = 190
    line_margin = 25
    for x in range(line_margin, W - line_margin):
        # Fading line effect
        dist = min(x - line_margin, W - line_margin - x)
        fade = min(1.0, dist / 20.0)
        c = tuple(int(TERRACOTTA_LIGHT[k] * fade * 0.6 + TERRACOTTA[k] * (1 - fade * 0.6)) for k in range(3))
        draw.point((x, line_y), fill=c)

    # Feature highlights with dots
    features = ["智能 AI 助手", "本地文件协作", "安全可靠"]
    font_feat = load_font(FONT_CN, 10, FONT_EN)
    for i, feat in enumerate(features):
        y = 210 + i * 24
        # Dot indicator
        draw.ellipse([28, y + 3, 34, y + 9], fill=TERRACOTTA_LIGHT)
        draw.text((42, y), feat, fill=WARM_WHITE, font=font_feat)

    # Bottom decorative pattern
    draw_decorative_dots(draw, 32, 285, 6, 2, 18, WARM_WHITE, TERRACOTTA)

    out_path = os.path.join(SCRIPT_DIR, "sidebar.bmp")
    img.save(out_path, "BMP")

    # Also save PNG preview
    img.save(os.path.join(SCRIPT_DIR, "sidebar_preview.png"), "PNG")
    print(f"✓ Sidebar: {out_path} ({W}×{H})")


def create_header_image():
    """Create 150x57 header BMP for NSIS installer pages."""
    W, H = 150, 57
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)

    # Subtle gradient
    gradient_fill(draw, (0, 0, W, H), CREAM, WARM_WHITE, direction="horizontal")

    # Thin accent line at bottom
    for x in range(W):
        ratio = x / W
        alpha = math.sin(ratio * math.pi) * 0.4
        c = tuple(int(TERRACOTTA[k] * alpha + WARM_WHITE[k] * (1 - alpha)) for k in range(3))
        draw.point((x, H - 1), fill=c)
        draw.point((x, H - 2), fill=c)

    # Load and paste small icon
    try:
        icon = Image.open(ICON_PATH).convert("RGBA")
        icon_size = 32
        icon = icon.resize((icon_size, icon_size), Image.LANCZOS)
        mask = Image.new("L", (icon_size, icon_size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, icon_size, icon_size], fill=255)
        icon_rgb = Image.new("RGB", (icon_size, icon_size), CREAM)
        icon_rgb.paste(icon, mask=icon.split()[3])
        img.paste(icon_rgb, (W - icon_size - 10, (H - icon_size) // 2), mask)
    except (OSError, IOError):
        pass

    # Text
    font_name = load_font(FONT_EN, 14)
    font_sub = load_font(FONT_EN, 9)

    draw.text((12, 12), "JAcoworks", fill=TERRACOTTA_DARK, font=font_name)
    draw.text((12, 32), "AI Assistant", fill=(150, 130, 110), font=font_sub)

    out_path = os.path.join(SCRIPT_DIR, "header.bmp")
    img.save(out_path, "BMP")
    img.save(os.path.join(SCRIPT_DIR, "header_preview.png"), "PNG")
    print(f"✓ Header: {out_path} ({W}×{H})")


if __name__ == "__main__":
    create_sidebar_image()
    create_header_image()
    print("\n✅ All installer images generated!")
