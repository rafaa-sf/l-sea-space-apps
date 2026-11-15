#!/usr/bin/env python3
"""Generate the L-SEA Space Apps Project Demo deck (7 slides, English).

Content mirrors docs/demo.md and uses the screenshots in docs/screenshots/.
Requires: python-pptx, Pillow, pyqrcode (for the live, repository and PDF QR codes).

Usage:
    python3 scripts/demo/build-demo-deck.py
Output:
    demo/L-SEA-Project-Demo.pptx
"""
from __future__ import annotations

import io
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

try:  # QR is optional: the deck still builds if pyqrcode is unavailable.
    import pyqrcode
except ImportError:  # pragma: no cover - environment dependent
    pyqrcode = None

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "screenshots"
OUT = ROOT / "demo" / "L-SEA-Project-Demo.pptx"

LIVE_URL = "https://rafaa-sf.github.io/l-sea-space-apps/"
REPO_URL = "https://github.com/rafaa-sf/l-sea-space-apps"
PDF_URL = "https://rafaa-sf.github.io/l-sea-space-apps/demo/L-SEA-Project-Demo.pdf"

BG = RGBColor(0x0B, 0x0D, 0x12)
PANEL = RGBColor(0x12, 0x15, 0x1D)
PANEL_ALT = RGBColor(0x17, 0x1B, 0x25)
BORDER = RGBColor(0x26, 0x2C, 0x3A)
TEXT = RGBColor(0xE8, 0xEC, 0xF4)
DIM = RGBColor(0x9A, 0xA4, 0xB8)
ACCENT = RGBColor(0x6E, 0xA8, 0xFF)
OK = RGBColor(0x5F, 0xD1, 0x8B)
WARN = RGBColor(0xFF, 0xB4, 0x54)
PURPLE = RGBColor(0xC0, 0x9B, 0xFF)

W = Inches(13.333)
H = Inches(7.5)


def solid(shape, color: RGBColor) -> None:
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.color.rgb = color


def add_bg(slide) -> None:
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    solid(bg, BG)


def add_panel(slide, left, top, width, height, color=PANEL, border=BORDER):
    panel = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    solid(panel, color)
    panel.line.color.rgb = border
    panel.line.width = Pt(0.75)
    panel.adjustments[0] = 0.06
    return panel


def add_line(slide, left, top, width, color=BORDER, weight=1.0):
    line = slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, left, top, left + width, top
    )
    line.line.color.rgb = color
    line.line.width = Pt(weight)
    return line


def paint(shape, fill, line=None, weight=0.75) -> None:
    """Fill a shape and optionally draw an outline (None removes it)."""
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(weight)


def add_arrow(slide, x1, y1, x2, y2, color=ACCENT, weight=1.75):
    """Straight connector with a triangular arrowhead at the end."""
    conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x1, y1, x2, y2)
    conn.line.color.rgb = color
    conn.line.width = Pt(weight)
    ln = conn.line._get_or_add_ln()
    tail = etree.SubElement(ln, qn("a:tailEnd"))
    tail.set("type", "triangle")
    tail.set("w", "med")
    tail.set("len", "med")
    return conn


def add_vbar(slide, left, top, height, color, width=0.05):
    bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, left, top, Inches(width), height
    )
    solid(bar, color)
    return bar


def add_text(
    slide,
    text,
    left,
    top,
    width,
    height,
    size=18,
    color=TEXT,
    bold=False,
    align=PP_ALIGN.LEFT,
    font="Calibri",
    anchor=MSO_ANCHOR.TOP,
    line_spacing=1.0,
):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = 0
    frame.margin_right = 0
    frame.margin_top = 0
    frame.margin_bottom = 0
    paragraph = frame.paragraphs[0]
    paragraph.alignment = align
    paragraph.line_spacing = line_spacing
    run = paragraph.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    return box


def add_bullets(
    slide,
    items,
    left,
    top,
    width,
    height,
    size=16,
    color=TEXT,
    space=10,
    line_spacing=1.0,
):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    frame.margin_left = 0
    frame.margin_right = 0
    frame.margin_top = 0
    frame.margin_bottom = 0
    for index, item in enumerate(items):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.space_after = Pt(space)
        paragraph.line_spacing = line_spacing
        run = paragraph.add_run()
        run.text = f"•  {item}"
        run.font.size = Pt(size)
        run.font.color.rgb = color
        run.font.name = "Calibri"
    return box


def add_notes(slide, text: str) -> None:
    slide.notes_slide.notes_text_frame.text = text


def add_footer(slide, number: int) -> None:
    # Minimal slide number only: the data attribution is repeated on the final slide.
    add_text(
        slide, f"{number} / 7", Inches(12.1), Inches(7.1), Inches(0.58), Inches(0.25),
        size=8.5, color=DIM, align=PP_ALIGN.RIGHT,
    )


def add_cover_image(slide, path: Path, left, top, width, height) -> None:
    """Add an image cropped to fill the given rectangle."""
    if not path.exists():
        return
    with Image.open(path) as image:
        img_w, img_h = image.size
    target_ratio = width / height
    img_ratio = img_w / img_h
    if img_ratio > target_ratio:
        crop = (1 - target_ratio / img_ratio) / 2
        pic = slide.shapes.add_picture(str(path), left, top, width=width, height=height)
        pic.crop_left = crop
        pic.crop_right = crop
    else:
        crop = (1 - img_ratio / target_ratio) / 2
        pic = slide.shapes.add_picture(str(path), left, top, width=width, height=height)
        pic.crop_top = crop
        pic.crop_bottom = crop


def add_cropped_image(slide, path: Path, left, top, width, height,
                      crop_left=0.0, crop_right=0.0, crop_top=0.0, crop_bottom=0.0):
    """Add an image with explicit source crops (fractions of the source image)."""
    if not path.exists():
        return
    pic = slide.shapes.add_picture(str(path), left, top, width=width, height=height)
    pic.crop_left = crop_left
    pic.crop_right = crop_right
    pic.crop_top = crop_top
    pic.crop_bottom = crop_bottom
    return pic



def add_chip(slide, text, left, top, width, height, color=ACCENT, size=10.5):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    solid(shape, PANEL_ALT)
    shape.line.color.rgb = BORDER
    shape.line.width = Pt(0.75)
    shape.adjustments[0] = 0.5
    add_text(
        slide, text, left + Inches(0.08), top, width - Inches(0.16), height,
        size=size, color=color, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
    )
    return shape


def add_card(slide, left, top, width, height, title, body, color=ACCENT,
             title_size=15, body_size=12.5, fill=PANEL):
    add_panel(slide, left, top, width, height, fill)
    add_line(slide, left + Inches(0.22), top + Inches(0.16), Inches(0.42),
             color=color, weight=2.0)
    add_text(slide, title, left + Inches(0.22), top + Inches(0.28),
             width - Inches(0.44), Inches(0.35), size=title_size, bold=True, color=color)
    add_text(slide, body, left + Inches(0.22), top + Inches(0.76),
             width - Inches(0.44), height - Inches(0.9), size=body_size, color=TEXT)


def add_number_step(slide, number, title, body, left, top, width):
    circle = slide.shapes.add_shape(
        MSO_SHAPE.OVAL, left, top + Inches(0.02), Inches(0.4), Inches(0.4)
    )
    solid(circle, PANEL_ALT)
    circle.line.color.rgb = ACCENT
    circle.line.width = Pt(1)
    add_text(
        slide, str(number), left, top + Inches(0.02), Inches(0.4), Inches(0.4),
        size=12, color=ACCENT, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
    )
    add_text(slide, title, left + Inches(0.58), top, width - Inches(0.58), Inches(0.3),
             size=13.5, bold=True, color=TEXT)
    add_text(slide, body, left + Inches(0.58), top + Inches(0.32),
             width - Inches(0.58), Inches(0.68), size=12, color=DIM, line_spacing=1.02)


def add_link_block(slide, label, url, left, top, width, color=TEXT, size=10.5):
    add_text(slide, label, left, top, width, Inches(0.2), size=9, color=DIM)
    add_text(slide, url, left, top + Inches(0.2), width, Inches(0.5),
             size=size, color=color)


def add_qr(slide, left, top, size, url=LIVE_URL, error="L"):
    """Generate a QR code in memory and place it on a white quiet-zone panel.

    The PNG already carries a four-module quiet zone; the white panel adds a
    further margin so the code also scans against the dark console background.
    Returns whether the code was added (pyqrcode is optional).
    """
    if pyqrcode is None:
        return False
    stream = io.BytesIO()
    qr = pyqrcode.create(url, error=error)
    qr.png(stream, scale=14, quiet_zone=4)
    stream.seek(0)
    add_panel(
        slide, left - Inches(0.08), top - Inches(0.08), size + Inches(0.16),
        size + Inches(0.16), color=RGBColor(0xFF, 0xFF, 0xFF),
        border=RGBColor(0xFF, 0xFF, 0xFF),
    )
    slide.shapes.add_picture(stream, left, top, width=size, height=size)
    return True


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H
    blank = prs.slide_layouts[6]

    shot_3d = SHOTS / "app-3d.png"
    shot_zones = SHOTS / "landing-zones-3d.png"
    shot_es = SHOTS / "app-3d-es.png"
    shot_extent = SHOTS / "custom-extent-3d.png"

    # ---------------------------------------------------------------- slide 1
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    # Focus the cover on the 3D viewport: crop the app chrome, header and timeline.
    add_cropped_image(slide, shot_3d, Inches(6.45), 0, Inches(6.883), H,
                      crop_left=0.342, crop_right=0.342, crop_top=0.13, crop_bottom=0.32)
    add_vbar(slide, Inches(6.37), Inches(0.7), Inches(6.1), BORDER, width=0.02)
    add_text(slide, "NASA SPACE APPS CHALLENGE  ·  MÁLAGA 2026",
             Inches(0.8), Inches(0.7), Inches(5.2), Inches(0.3),
             size=11.5, color=ACCENT, bold=True)
    add_text(slide, "L-SEA", Inches(0.8), Inches(1.0), Inches(4.5), Inches(1.0),
             size=58, color=ACCENT, bold=True)
    add_text(slide, "Lunar Landing Site\nNavigator",
             Inches(0.8), Inches(2.05), Inches(5.2), Inches(1.25),
             size=30, bold=True, line_spacing=0.95)
    add_line(slide, Inches(0.8), Inches(3.48), Inches(2.3), color=ACCENT, weight=2.0)
    add_text(slide, "Choosing where to land on the Moon,\nbacked by data.",
             Inches(0.8), Inches(3.65), Inches(5.3), Inches(0.9),
             size=22, bold=True, line_spacing=0.98)
    add_text(slide,
             "Compare lunar south-pole landing sites and mission dates\n"
             "with real NASA data.",
             Inches(0.8), Inches(4.72), Inches(5.25), Inches(0.75),
             size=15, color=DIM, line_spacing=1.02)
    add_text(slide, "Team Rafael & Marcos", Inches(0.8), Inches(5.62),
             Inches(5.2), Inches(0.3), size=14, bold=True)
    add_text(slide, "Challenge 10  ·  CSA  ·  Lunar Landing Site Navigator",
             Inches(0.8), Inches(5.96), Inches(5.2), Inches(0.3),
             size=10.5, color=DIM)
    add_notes(slide,
              "Cover. L-SEA — Lunar Landing Site Navigator. Team Rafael & Marcos, "
              "NASA Space Apps Challenge Málaga 2026. Seven slides in English. Live and "
              "repository links are on the final slide to avoid repetition.")
    add_footer(slide, 1)

    # ---------------------------------------------------------------- slide 2
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "The problem", Inches(0.62), Inches(0.42), Inches(8), Inches(0.6),
             size=30, bold=True)
    add_text(slide, "A landing site is a system decision, not a map pin.",
             Inches(0.62), Inches(1.02), Inches(7.8), Inches(0.35),
             size=14, color=ACCENT)
    add_cover_image(slide, SHOTS / "problem-lowpoly.png", Inches(0.62), Inches(1.46),
                    Inches(8.32), Inches(4.68))

    constraints = [
        ("Coupled limits",
         "Power, thermal and comms succeed or fail together.", OK),
        ("Terrain horizon",
         "Local ridges, not a flat horizon, set Sun and Earth access.", ACCENT),
        ("Ellipse, not a point",
         "A landing zone spans kilometres of unseen terrain.", WARN),
        ("Site and date",
         "Small changes flip sunlight and Earth contact for the mission.", PURPLE),
        ("Scattered evidence",
         "NASA tools are deep, but built for analysis, not comparison.", DIM),
    ]
    y = 1.55
    for label, detail, color in constraints:
        add_vbar(slide, Inches(9.28), Inches(y + 0.01), Inches(0.72), color, width=0.045)
        add_text(slide, label, Inches(9.5), Inches(y - 0.03), Inches(3.18), Inches(0.26),
                 size=11.5, bold=True, color=color)
        add_text(slide, detail, Inches(9.5), Inches(y + 0.25), Inches(3.16), Inches(0.56),
                 size=9.7, color=TEXT, line_spacing=0.98)
        y += 0.9

    add_panel(slide, Inches(0.62), Inches(6.3), Inches(12.11), Inches(0.5),
              color=PANEL_ALT)
    add_text(slide, "Two kilometres or two weeks can change the whole mission.",
             Inches(0.86), Inches(6.39), Inches(11.6), Inches(0.3),
             size=14, bold=True, color=ACCENT)
    add_notes(slide,
              "Hook: the low-poly schematic shows the real geometry, not a photo. The Sun "
              "sits about 1.6 degrees above the horizon, Earth is low, and the local ridge "
              "line decides what the site can see. Power, thermal, comms and terrain are "
              "coupled: move the landing ellipse two kilometres or the date two weeks and "
              "sunlight and Earth contact change. The evidence is also scattered across "
              "specialist NASA tools, which is the opening for L-SEA in the next slide.")
    add_footer(slide, 2)

    # ---------------------------------------------------------------- slide 3
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "One mission console", Inches(0.62), Inches(0.38), Inches(8),
             Inches(0.6), size=30, bold=True)
    add_text(slide, "From a LOLA DEM to a defensible site-and-date decision.",
             Inches(0.62), Inches(0.96), Inches(8.4), Inches(0.35),
             size=14, color=DIM)

    add_panel(slide, Inches(0.55), Inches(1.46), Inches(12.23), Inches(3.92))
    sun_color = RGBColor(0xD8, 0xB1, 0x56)
    earth_color = RGBColor(0x6F, 0xA8, 0xD8)
    facet_dark = RGBColor(0x1A, 0x22, 0x30)
    facet_mid = RGBColor(0x23, 0x2D, 0x3D)

    def icon_box(kind, x, y, w, h, fill, line=None, weight=0.9):
        shape = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
        paint(shape, fill, line, weight)
        return shape

    def icon_line(x1, y1, x2, y2, color, weight=1.0):
        conn = slide.shapes.add_connector(
            MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2)
        )
        conn.line.color.rgb = color
        conn.line.width = Pt(weight)
        return conn

    nodes = [
        ("DEM region", "mountains", ACCENT, "7 polar regions"),
        ("Ray-traced local horizon", "horizon", ACCENT, "LOLA + curvature"),
        ("Sun and Earth", "sunearth", ACCENT, "JPL Horizons"),
        ("Power, comms, thermal", "systems", WARN, "coupled limits"),
        ("Hard feasibility gates", "gate", WARN, "pass / fail"),
        ("Autopilot + feasible date", "rank", OK, "12-hour search"),
        ("Decision / JSON brief", "brief", OK, "NASA source links"),
    ]
    node_w = 1.40
    gap = 0.315
    step = node_w + gap
    node_left = 0.82
    node_top = 1.98
    node_h = 2.80

    groups = [
        ("NASA DATA + TERRAIN", 0, 3, ACCENT),
        ("MISSION LIMITS", 3, 5, WARN),
        ("DECISION", 5, 7, OK),
    ]
    for label, first, last, color in groups:
        group_left = node_left + first * step
        group_width = (last - first) * step - gap
        add_text(slide, label, Inches(group_left), Inches(1.59), Inches(group_width),
                 Inches(0.22), size=8.2, bold=True, color=color)
        add_line(slide, Inches(group_left), Inches(1.85), Inches(group_width),
                 color=color, weight=1.0)

    for index, (caption, icon, color, sublabel) in enumerate(nodes):
        x = node_left + index * step
        add_panel(slide, Inches(x), Inches(node_top), Inches(node_w), Inches(node_h),
                  color=PANEL_ALT)
        icon_box(MSO_SHAPE.OVAL, x + 0.10, node_top + 0.10, 0.28, 0.28, PANEL, color, 1.0)
        add_text(slide, f"{index + 1:02d}", Inches(x + 0.10), Inches(node_top + 0.10),
                 Inches(0.28), Inches(0.28), size=8.5, bold=True, color=color,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        cx = x + node_w / 2
        cy = node_top + 0.86
        if icon == "mountains":
            for dx, height, width, fill in (
                (-0.22, 0.30, 0.30, facet_dark),
                (0.03, 0.47, 0.36, facet_mid),
                (0.26, 0.25, 0.26, facet_dark),
            ):
                icon_box(MSO_SHAPE.ISOSCELES_TRIANGLE, cx + dx - width / 2,
                         cy + 0.22 - height, width, height, fill, ACCENT, 0.9)
        elif icon == "horizon":
            icon_line(cx - 0.33, cy + 0.22, cx + 0.33, cy + 0.22, DIM, 1.2)
            icon_box(MSO_SHAPE.ISOSCELES_TRIANGLE, cx + 0.02, cy + 0.02, 0.24, 0.22,
                     facet_mid, ACCENT, 0.9)
            icon_box(MSO_SHAPE.OVAL, cx - 0.28, cy - 0.18, 0.1, 0.1, ACCENT)
            icon_line(cx - 0.23, cy - 0.13, cx - 0.02, cy + 0.20, ACCENT, 0.9)
            icon_line(cx - 0.23, cy - 0.13, cx + 0.14, cy + 0.08, ACCENT, 0.9)
        elif icon == "sunearth":
            icon_line(cx - 0.34, cy + 0.24, cx + 0.34, cy + 0.24, DIM, 1.2)
            icon_box(MSO_SHAPE.OVAL, cx - 0.27, cy - 0.10, 0.19, 0.19, sun_color,
                     RGBColor(0xF2, 0xD1, 0x8A), 0.9)
            icon_box(MSO_SHAPE.OVAL, cx + 0.10, cy - 0.01, 0.21, 0.21, earth_color,
                     RGBColor(0xA8, 0xC8, 0xE8), 0.9)
        elif icon == "systems":
            icon_box(MSO_SHAPE.LIGHTNING_BOLT, cx - 0.31, cy - 0.15, 0.16, 0.27, WARN)
            for bar, height in enumerate((0.08, 0.14, 0.21)):
                icon_box(MSO_SHAPE.RECTANGLE, cx - 0.04 + bar * 0.07,
                         cy + 0.22 - height, 0.04, height, ACCENT)
            icon_box(MSO_SHAPE.ROUNDED_RECTANGLE, cx + 0.23, cy - 0.12, 0.07, 0.24, WARN)
            icon_box(MSO_SHAPE.OVAL, cx + 0.215, cy + 0.08, 0.10, 0.10, WARN)
        elif icon == "gate":
            icon_line(cx - 0.31, cy - 0.28, cx - 0.31, cy + 0.28, BORDER, 1.4)
            icon_line(cx - 0.22, cy - 0.02, cx - 0.05, cy + 0.16, OK, 3.2)
            icon_line(cx - 0.05, cy + 0.16, cx + 0.26, cy - 0.20, OK, 3.2)
        elif icon == "rank":
            for bar, (height, color) in enumerate(((0.16, ACCENT), (0.28, ACCENT),
                                                   (0.40, OK))):
                icon_box(MSO_SHAPE.RECTANGLE, cx - 0.28 + bar * 0.12,
                         cy + 0.23 - height, 0.08, height, color)
            icon_box(MSO_SHAPE.OVAL, cx + 0.16, cy - 0.12, 0.26, 0.26, PANEL, WARN, 1.1)
            icon_line(cx + 0.29, cy + 0.01, cx + 0.29, cy - 0.07, WARN, 1.2)
            icon_line(cx + 0.29, cy + 0.01, cx + 0.35, cy + 0.05, WARN, 1.2)
        elif icon == "brief":
            icon_box(MSO_SHAPE.FOLDED_CORNER, cx - 0.18, cy - 0.26, 0.36, 0.48,
                     facet_dark, ACCENT, 1.0)
            for text_line in range(3):
                icon_box(MSO_SHAPE.RECTANGLE, cx - 0.11, cy - 0.13 + text_line * 0.09,
                         0.22, 0.025, DIM)

        add_text(slide, caption, Inches(x + 0.08), Inches(node_top + 1.48),
                 Inches(node_w - 0.16), Inches(0.74), size=10.3, color=TEXT,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, line_spacing=0.98)
        add_text(slide, sublabel, Inches(x + 0.08), Inches(node_top + 2.26),
                 Inches(node_w - 0.16), Inches(0.22), size=8.3, color=DIM,
                 align=PP_ALIGN.CENTER)

    for index in range(len(nodes) - 1):
        x = node_left + index * step + node_w + 0.045
        arrow = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x),
                                       Inches(node_top + 1.28), Inches(0.225),
                                       Inches(0.13))
        paint(arrow, ACCENT)

    add_panel(slide, Inches(0.55), Inches(5.52), Inches(12.23), Inches(0.52),
              color=PANEL_ALT)
    add_text(slide, "Terrain comes first: every downstream number depends on the "
                    "local horizon.",
             Inches(0.84), Inches(5.61), Inches(11.7), Inches(0.3),
             size=14, bold=True, color=ACCENT)
    add_text(slide, "7 LOLA polar DEMs  ·  100–608 km  ·  EN / ES  ·  JSON mission brief",
             Inches(0.62), Inches(6.16), Inches(12.1), Inches(0.25),
             size=9.2, color=DIM)
    add_notes(slide,
              "This is the whole console as one flow. A LOLA DEM region feeds a "
              "ray-traced local horizon; the horizon decides where the Sun and Earth are "
              "visible; those feed power, thermal and direct/relay comms; hard feasibility "
              "gates reject infeasible cases; autopilot ranks the surviving zones and "
              "searches the earliest feasible mission date; the result is a decision and "
              "a JSON brief with NASA source links. Terrain comes first at every step.")
    add_footer(slide, 3)

    # ---------------------------------------------------------------- slide 4
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Live demo", Inches(0.65), Inches(0.45), Inches(8), Inches(0.6),
             size=32, bold=True)
    add_text(slide, "South pole → site or zone → date → evidence.",
             Inches(0.65), Inches(1.08), Inches(4.6), Inches(0.35),
             size=14, color=DIM)
    add_number_step(slide, 1, "Pick a region",
                    "608 km wide area or 152 km high detail.", Inches(0.65), Inches(1.55),
                    Inches(4.55))
    add_number_step(slide, 2, "Pick a site or zone",
                    "Curated site, custom coordinate or a detected flat zone.",
                    Inches(0.65), Inches(2.7), Inches(4.55))
    add_number_step(slide, 3, "Change the date or preset",
                    "Apollo to Artemis mission presets; watch Sun and Earth move against "
                    "the terrain.", Inches(0.65), Inches(3.85), Inches(4.55))
    add_number_step(slide, 4, "Compare and export",
                    "Three-site comparator, Sun/link cycle band, JSON mission brief.",
                    Inches(0.65), Inches(5.0), Inches(4.55))

    add_cropped_image(slide, shot_zones, Inches(5.45), Inches(1.32), Inches(7.45),
                      Inches(4.5), crop_left=0.0, crop_right=0.25,
                      crop_top=0.137, crop_bottom=0.137)
    add_text(slide,
             "3D oblique · Autopilot ranked landing zones and feasible mission dates on the 608 km LOLA DEM.",
             Inches(5.45), Inches(5.9), Inches(7.45), Inches(0.22),
             size=8.5, color=DIM)
    add_panel(slide, Inches(0.65), Inches(6.18), Inches(12.15), Inches(0.68),
              color=PANEL_ALT)
    add_text(slide, "LIVE DEMO", Inches(0.88), Inches(6.34), Inches(1.4), Inches(0.3),
             size=10, color=OK, bold=True)
    add_text(slide, "No install  ·  no login  ·  links on the final slide",
             Inches(2.25), Inches(6.37), Inches(9.6), Inches(0.3),
             size=11, color=DIM)
    add_notes(slide,
              "Key demo moment: change the mission date by a few weeks, or switch an "
              "Apollo/Artemis preset, and show the sunlight margin and Earth visibility "
              "change live. Then compare three sites and export the brief. The live URL is "
              "on screen.")
    add_footer(slide, 4)

    # ---------------------------------------------------------------- slide 5
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "What makes it different",
             Inches(0.65), Inches(0.45), Inches(9), Inches(0.6),
             size=32, bold=True)
    add_text(slide, "Not a Sun calculator: a feasibility-first site-and-date decision tool.",
             Inches(0.65), Inches(1.08), Inches(10.5), Inches(0.35),
             size=14, color=DIM)
    add_card(slide, Inches(0.65), Inches(1.55), Inches(5.95), Inches(2.1),
             "Terrain-first horizon",
             "Ray-traced LOLA horizon with lunar curvature, not a flat-horizon "
             "approximation. Terrain shadowing, not Sun angle alone, drives polar power.",
             ACCENT, title_size=16, body_size=12.5)
    add_card(slide, Inches(6.72), Inches(1.55), Inches(5.95), Inches(2.1),
             "Feasibility before score",
             "Hard gates on continuous sunlight, battery sized to the longest eclipse, "
             "thermal range and data. Feasible zones always sort above infeasible ones, "
             "whatever their score.", OK, title_size=16, body_size=12.5)
    add_card(slide, Inches(0.65), Inches(3.85), Inches(5.95), Inches(2.1),
             "Date as a decision variable",
             "Autopilot searches the earliest feasible mission start at 12-hour steps, so "
             "a schedule change becomes a site recommendation.", WARN, title_size=16,
             body_size=12.5)
    add_card(slide, Inches(6.72), Inches(3.85), Inches(5.95), Inches(2.1),
             "Reproducible by design",
             "Deterministic scoring with documented weights, reasons and an input "
             "signature; 269 tests in 19 files guard the contracts.", PURPLE,
             title_size=16, body_size=12.5)
    add_panel(slide, Inches(0.65), Inches(6.2), Inches(12.02), Inches(0.45),
              color=PANEL_ALT)
    add_text(slide, "No black box: every rank exposes weights, reasons, warnings and "
                    "confidence.",
             Inches(0.88), Inches(6.25), Inches(11.5), Inches(0.35),
             size=12.5, color=ACCENT, bold=True)
    add_notes(slide,
              "Differentiators: the terrain horizon is ray traced; the autopilot is "
              "feasibility-first; the earliest feasible date is searched, not guessed. "
              "Stay within the modelled scope and the documented limits.")
    add_footer(slide, 5)

    # ---------------------------------------------------------------- slide 6
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "How it's built", Inches(0.65), Inches(0.4), Inches(8), Inches(0.6),
             size=32, bold=True)
    add_text(slide, "Real NASA data and tests that guard the claims.",
             Inches(0.65), Inches(1.04), Inches(9.5), Inches(0.35),
             size=14, color=DIM)

    add_card(slide, Inches(0.65), Inches(1.45), Inches(3.55), Inches(1.22),
             "NASA LOLA polar DEMs", "7 regions, 100–608 km; 608 km at 2048 px; 74 m/px "
             "high detail.", OK, title_size=12.5, body_size=9.5)
    add_card(slide, Inches(4.35), Inches(1.45), Inches(3.55), Inches(1.22),
             "JPL Horizons", "Topocentric Sun/Earth; 30-min steps; Nov–Dec 2026.",
             ACCENT, title_size=12.5, body_size=9.5)
    add_card(slide, Inches(0.65), Inches(2.8), Inches(3.55), Inches(1.22),
             "NASA Moon Trek", "33 verified south-pole layers: illumination, Earth "
             "visibility, PSR, temperature, rock abundance.", WARN,
             title_size=12.5, body_size=9.5)
    add_card(slide, Inches(4.35), Inches(2.8), Inches(3.55), Inches(1.22),
             "LROC QuickMap", "Site cross-checks and deep links in the JSON mission brief.",
             PURPLE, title_size=12.5, body_size=9.5)

    add_cropped_image(slide, shot_extent, Inches(8.25), Inches(1.45), Inches(4.4),
                      Inches(2.75), crop_left=0.20, crop_right=0.24,
                      crop_top=0.22, crop_bottom=0.22)
    add_text(slide,
             "3D oblique · Moon Trek average Earth-visibility layer on the 400 km DEM "
             "extent; 7 selectable regions, 100–608 km.",
             Inches(8.25), Inches(4.22), Inches(4.4), Inches(0.34),
             size=8.2, color=DIM, line_spacing=1.0)

    add_panel(slide, Inches(0.65), Inches(4.5), Inches(5.85), Inches(2.25))
    add_text(slide, "Quality evidence", Inches(0.88), Inches(4.65), Inches(5.4),
             Inches(0.3), size=14, bold=True, color=TEXT)
    add_text(slide, "269 tests in 19 files, all passing",
             Inches(0.88), Inches(5.02), Inches(5.4), Inches(0.3), size=13, bold=True,
             color=OK)
    add_text(slide, "Terrain validation: 2 regions + 4 presets, 0 failures",
             Inches(0.88), Inches(5.38), Inches(5.4), Inches(0.25), size=10.3,
             color=TEXT)
    add_text(slide, "Horizons spot-check: 480/480 samples, max 0.0000°",
             Inches(0.88), Inches(5.68), Inches(5.4), Inches(0.25), size=10.3,
             color=TEXT)
    add_text(slide, "Deterministic core shared by UI, worker and tests.",
             Inches(0.88), Inches(5.98), Inches(5.4), Inches(0.25), size=9.5, color=DIM)

    add_panel(slide, Inches(6.7), Inches(4.5), Inches(5.95), Inches(2.25))
    add_text(slide, "Honest limits", Inches(6.93), Inches(4.65), Inches(5.4), Inches(0.3),
             size=14, bold=True, color=WARN)
    add_bullets(slide, [
        "Two-month ephemeris window: 2026-11-01 → 2026-12-31.",
        "DEM resolution: 74 m/px high detail; 297–594 m/px wide-area grids.",
        "Heuristic crater detection feeds hazards; large complex craters can be missed.",
        "Prototype for planning and education — not flight certification.",
    ], Inches(6.93), Inches(5.04), Inches(5.45), Inches(1.2), size=10.3, space=4,
        line_spacing=1.0)
    add_text(slide, "The app repeats these limits in its Assumptions & limits panel.",
             Inches(6.93), Inches(6.33), Inches(5.45), Inches(0.25),
             size=8.8, color=DIM)
    add_notes(slide,
              "NASA data: LOLA terrain, Horizons Sun/Earth, Moon Trek's 33 verified layers "
              "and QuickMap links. Quality: 269 tests in 19 files, terrain validation with "
              "2 source regions plus 4 area presets and 0 failures, and a 480/480 Horizons "
              "spot-check. Be explicit about the limits: the two-month ephemeris window, DEM "
              "resolution, heuristic crater detection that can miss large complex craters, "
              "and prototype status.")
    add_footer(slide, 6)

    # ---------------------------------------------------------------- slide 7
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Open source, free for mission planning and education",
             Inches(0.65), Inches(0.45), Inches(12.0), Inches(0.6),
             size=32, bold=True)
    add_text(slide, "Open source under MIT: free public demo, free SaaS or self-host, "
                    "free teaching materials.",
             Inches(0.65), Inches(1.08), Inches(9.8), Inches(0.35),
             size=13.5, color=DIM)

    add_panel(slide, Inches(0.65), Inches(1.42), Inches(7.1), Inches(0.55),
              color=PANEL_ALT)
    add_vbar(slide, Inches(0.65), Inches(1.42), Inches(0.55), OK, width=0.05)
    add_text(slide, "Impact: faster, defensible site and date screening for planners.\n"
                    "A free, bilingual teaching aid for education and outreach.",
             Inches(0.9), Inches(1.5), Inches(6.65), Inches(0.4),
             size=11.5, color=OK, line_spacing=1.0)

    add_panel(slide, Inches(0.65), Inches(2.08), Inches(7.1), Inches(1.42))
    add_text(slide, "MIT license for code and documentation",
             Inches(0.9), Inches(2.24), Inches(6.6), Inches(0.3),
             size=14.5, bold=True, color=OK)
    add_bullets(slide, [
        "Code, scripts, tests, docs and this deck: MIT, © 2026 L-SEA Team.",
        "Use, modify, redistribute and self-host; keep the copyright and permission notice.",
        "NASA data keeps its own public-domain and attribution terms.",
    ], Inches(0.9), Inches(2.62), Inches(6.55), Inches(0.8), size=11, space=3,
        line_spacing=1.0)

    add_panel(slide, Inches(0.65), Inches(3.63), Inches(7.1), Inches(1.62))
    add_text(slide, "Free to use, host and teach", Inches(0.9), Inches(3.79),
             Inches(6.6), Inches(0.3), size=14.5, bold=True, color=ACCENT)
    add_bullets(slide, [
        "Free public demo: no install, no login and no payment.",
        "Free SaaS or self-host: deploy the static build under MIT; no paid edition, no "
        "locked features.",
        "Free educational materials: the deck and workshop kit are MIT, reusable with "
        "attribution.",
    ], Inches(0.9), Inches(4.18), Inches(6.55), Inches(0.95), size=11, space=3,
        line_spacing=1.0)

    add_panel(slide, Inches(0.65), Inches(5.38), Inches(7.1), Inches(1.32))
    add_text(slide, "Next steps", Inches(0.9), Inches(5.54), Inches(6.6), Inches(0.3),
             size=14.5, bold=True, color=WARN)
    add_bullets(slide, [
        "Wider ephemeris beyond the shipped two-month window (2026–2027 binary).",
        "Catalogue-based crater mapping and crater-floor ranking; the heuristic detector "
        "is a known limitation.",
    ], Inches(0.9), Inches(5.92), Inches(6.55), Inches(0.65), size=11, space=3,
        line_spacing=1.0)

    add_panel(slide, Inches(8.0), Inches(1.42), Inches(4.65), Inches(5.28))
    add_text(slide, "Try it, host it, teach it",
             Inches(8.25), Inches(1.56), Inches(4.1), Inches(0.3),
             size=15, bold=True, color=ACCENT)
    add_text(slide, "Scan with a phone camera, or type the URL.",
             Inches(8.25), Inches(1.86), Inches(4.05), Inches(0.25),
             size=8.5, color=DIM)

    qr_links = [
        ("LIVE APP", LIVE_URL, "Free public demo, no install or login", ACCENT),
        ("REPOSITORY", REPO_URL, "MIT source code, issues and documentation", TEXT),
        ("PROJECT DEMO PDF", PDF_URL, "This deck as a public PDF", DIM),
    ]
    for (label, url, caption, color), top in zip(
        qr_links, (Inches(2.2), Inches(3.6), Inches(5.0))
    ):
        add_qr(slide, Inches(8.24), top, Inches(1.2), url=url)
        add_text(slide, label, Inches(9.68), top - Inches(0.03), Inches(2.85),
                 Inches(0.24), size=10, bold=True, color=color)
        add_text(slide, caption, Inches(9.68), top + Inches(0.22), Inches(2.82),
                 Inches(0.34), size=8.5, color=DIM, line_spacing=1.0)
        add_text(slide, url, Inches(9.68), top + Inches(0.56), Inches(2.82),
                 Inches(0.6), size=8.2, color=DIM, line_spacing=1.0)

    add_text(slide, "MIT  ·  free to use, host and teach",
             Inches(8.25), Inches(6.34), Inches(4.1), Inches(0.28),
             size=9.5, color=OK, bold=True)
    add_notes(slide,
              "Close: L-SEA is open source under the MIT license and free to use. The code, "
              "scripts, tests, documentation and deck are MIT; the public demo needs no "
              "install, login or payment; anyone can deploy it as a SaaS or self-host it "
              "under the same terms, with no paid edition or locked features; and the "
              "educational materials and workshop kit are free to reuse with attribution. "
              "The impact is faster, defensible site and date screening for planners, plus a "
              "free bilingual teaching aid for education and outreach. Next: a wider "
              "2026-2027 ephemeris and catalogue-based crater mapping with crater-floor "
              "ranking; the heuristic crater detector remains a known limitation. Point to "
              "the live app, repository and PDF; the three QR codes encode those exact URLs.")
    add_footer(slide, 7)

    prs.core_properties.title = "L-SEA — Lunar Landing Site Navigator"
    prs.core_properties.author = "Rafael & Marcos"
    prs.core_properties.subject = "NASA Space Apps Challenge Málaga 2026 — L-SEA Project Demo"
    prs.core_properties.keywords = (
        "L-SEA, lunar south pole, landing site, NASA LOLA, JPL Horizons, Moon Trek"
    )
    prs.core_properties.comments = (
        "7-slide English Project Demo. Public PDF: "
        "https://rafaa-sf.github.io/l-sea-space-apps/demo/L-SEA-Project-Demo.pdf"
    )
    prs.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
