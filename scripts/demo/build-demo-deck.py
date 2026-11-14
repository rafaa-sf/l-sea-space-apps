#!/usr/bin/env python3
"""Generate the L-SEA Space Apps Project Demo deck (7 slides, English).

Content mirrors docs/demo.md and uses the screenshots in docs/screenshots/.
Requires: python-pptx.

Usage:
    python3 scripts/demo/build-demo-deck.py
Output:
    demo/L-SEA-Project-Demo.pptx
"""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "screenshots"
OUT = ROOT / "demo" / "L-SEA-Project-Demo.pptx"

BG = RGBColor(0x0B, 0x0D, 0x12)
PANEL = RGBColor(0x12, 0x15, 0x1D)
PANEL_ALT = RGBColor(0x17, 0x1B, 0x25)
BORDER = RGBColor(0x26, 0x2C, 0x3A)
TEXT = RGBColor(0xE8, 0xEC, 0xF4)
DIM = RGBColor(0x9A, 0xA4, 0xB8)
ACCENT = RGBColor(0x6E, 0xA8, 0xFF)
OK = RGBColor(0x5F, 0xD1, 0x8B)
WARN = RGBColor(0xFF, 0xB4, 0x54)

W = Inches(13.333)
H = Inches(7.5)
SLIDE_W = 13.333


def solid(shape, color: RGBColor) -> None:
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.color.rgb = color


def add_bg(slide) -> None:
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    solid(bg, BG)


def add_panel(slide, left, top, width, height, color=PANEL):
    panel = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    solid(panel, color)
    panel.line.color.rgb = BORDER
    panel.line.width = Pt(1)
    panel.adjustments[0] = 0.05
    return panel


def add_text(slide, text, left, top, width, height, size=18, color=TEXT, bold=False,
             align=PP_ALIGN.LEFT, font="Calibri", anchor=MSO_ANCHOR.TOP):
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
    run = paragraph.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    return box


def add_bullets(slide, items, left, top, width, height, size=17, color=TEXT, space=8):
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
        run = paragraph.add_run()
        run.text = f"•  {item}"
        run.font.size = Pt(size)
        run.font.color.rgb = color
        run.font.name = "Calibri"
    return box


def add_notes(slide, text: str) -> None:
    slide.notes_slide.notes_text_frame.text = text


def add_footer(slide, number: int) -> None:
    add_text(
        slide,
        "L-SEA Space Apps  ·  NASA Space Apps Challenge Málaga 2026  ·  "
        "Data: JPL Horizons · LOLA/PDS · Moon Trek · LROC QuickMap",
        Inches(0.55), Inches(7.05), Inches(11.4), Inches(0.3),
        size=9, color=DIM,
    )
    add_text(slide, f"{number} / 7", Inches(12.3), Inches(7.05), Inches(0.6), Inches(0.3),
             size=9, color=DIM, align=PP_ALIGN.RIGHT)


def add_cover_image(slide, path: Path, left, top, width, height) -> None:
    """Add an image cropped to fill the given rectangle."""
    from PIL import Image

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


def chip(slide, text, left, top, width, height, color=ACCENT, size=12):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    solid(shape, PANEL_ALT)
    shape.line.color.rgb = BORDER
    shape.adjustments[0] = 0.5
    add_text(slide, text, left + Inches(0.12), top + Inches(0.03), width - Inches(0.24),
             height, size=size, color=color, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return shape


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs = Presentation()
    prs.slide_width = W
    prs.slide_height = H
    blank = prs.slide_layouts[6]

    shot_3d = SHOTS / "app-3d.png"
    shot_2d = SHOTS / "app-2d-es.png"

    # ---------------------------------------------------------------- slide 1
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_cover_image(slide, shot_3d, Inches(6.4), 0, Inches(6.933), H)
    add_text(slide, "L-SEA", Inches(0.75), Inches(0.85), Inches(5), Inches(0.8),
             size=40, color=ACCENT, bold=True)
    add_text(slide, "Lunar Landing Site Navigator",
             Inches(0.75), Inches(1.75), Inches(5.4), Inches(1.4), size=34, bold=True)
    add_text(slide,
             "Compare lunar south-pole landing sites and dates in seconds —\n"
             "Sun and Earth relative to the terrain horizon.",
             Inches(0.75), Inches(3.25), Inches(5.3), Inches(1.2), size=18, color=DIM)
    chip(slide, "NASA Space Apps Challenge · Málaga 2026", Inches(0.75), Inches(4.75),
         Inches(4.6), Inches(0.42))
    chip(slide, "Challenge: Lunar Landing Site Navigator", Inches(0.75), Inches(5.3),
         Inches(4.6), Inches(0.42), color=OK)
    add_text(slide, "github.com/rafaa-sf/l-sea-space-apps",
             Inches(0.75), Inches(6.15), Inches(5.4), Inches(0.4), size=13, color=DIM)
    add_notes(slide, "Cover. L-SEA Space Apps — Lunar Landing Site Navigator. "
                     "NASA Space Apps Challenge Málaga 2026. Repo link on screen.")
    add_footer(slide, 1)

    # ---------------------------------------------------------------- slide 2
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "The problem", Inches(0.75), Inches(0.7), Inches(8), Inches(0.8),
             size=34, bold=True)
    add_bullets(slide, [
        "At the Moon's south pole, a small change in landing site or date can flip "
        "sunlight and Earth visibility for the whole mission.",
        "Power generation and direct-to-Earth comms depend on the Sun and Earth "
        "relative to the local terrain horizon.",
        "The data exists (QuickMap, Moon Trek, JPL Horizons) but the tools are built "
        "for detailed analysis, not rapid scenario comparison.",
        "Missing: an intuitive tool that turns ephemeris and topography into "
        "comparable visualizations.",
    ], Inches(0.75), Inches(1.75), Inches(6.2), Inches(4.2), size=17)

    add_panel(slide, Inches(7.35), Inches(1.75), Inches(2.55), Inches(2.2), PANEL_ALT)
    add_text(slide, "Weeks of sunlight", Inches(7.6), Inches(2.05), Inches(2.1), Inches(0.5),
             size=16, bold=True, color=OK)
    add_text(slide, "Permanently lit ridge", Inches(7.6), Inches(2.6), Inches(2.1), Inches(0.9),
             size=13, color=DIM)
    add_text(slide, "vs", Inches(10.15), Inches(2.7), Inches(0.7), Inches(0.5),
             size=20, color=DIM, align=PP_ALIGN.CENTER)
    add_panel(slide, Inches(10.9), Inches(1.75), Inches(1.7), Inches(2.2), PANEL_ALT)
    add_text(slide, "Permanent shadow",
             Inches(11.05), Inches(2.05), Inches(1.5), Inches(0.9),
             size=15, bold=True, color=WARN)
    add_text(slide, "Craters near the pole", Inches(11.05), Inches(2.9), Inches(1.5), Inches(0.7),
             size=12, color=DIM)
    add_text(slide, "Two kilometres can change everything.",
             Inches(7.35), Inches(4.35), Inches(5.25), Inches(0.5), size=17, bold=True,
             color=ACCENT)
    add_notes(slide, "Hook: 'On the Moon, moving your landing site two kilometres can "
                     "mean the difference between weeks of sunlight and permanent shadow.'")
    add_footer(slide, 2)

    # ---------------------------------------------------------------- slide 3
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "One workflow, seconds per scenario",
             Inches(0.75), Inches(0.7), Inches(10), Inches(0.8), size=30, bold=True)

    steps = ["Select site", "Choose date", "Sun & Earth vs horizon", "Compare & rank", "Export brief"]
    x = 0.75
    for index, step in enumerate(steps):
        width = 2.25
        panel = add_panel(slide, Inches(x), Inches(1.9), Inches(width), Inches(1.1))
        add_text(slide, f"{index + 1}", Inches(x + 0.14), Inches(2.02), Inches(0.4), Inches(0.4),
                 size=15, color=ACCENT, bold=True)
        add_text(slide, step, Inches(x + 0.14), Inches(2.35), Inches(width - 0.28), Inches(0.5),
                 size=13, color=TEXT)
        x += width + 0.18

    add_bullets(slide, [
        "10 curated south-pole sites (nine Artemis III candidate regions + Shackleton rim), "
        "custom coordinates, or a map pointer.",
        "Real LOLA terrain in 3D, with a Canvas-2D fallback for machines without WebGL.",
        "Sun and Earth computed from pre-computed JPL Horizons ephemerides.",
        "Ray-traced horizon with lunar curvature, sunset / Earthset countdowns, power and "
        "direct-to-Earth comms windows.",
        "Mission autopilot ranks sites against the mission profile; JSON brief exports with "
        "QuickMap and Moon Trek links.",
        "English and Spanish interface.",
    ], Inches(0.75), Inches(3.55), Inches(7.4), Inches(3.1), size=16)

    if shot_2d.exists():
        add_cover_image(slide, shot_2d, Inches(8.55), Inches(3.35), Inches(4.1), Inches(3.45))
    add_notes(slide, "Solution: one flow — pick site, pick date, see Sun/Earth against the "
                     "terrain horizon, compare and rank, export the brief. Mention EN/ES and 2D fallback.")
    add_footer(slide, 3)

    # ---------------------------------------------------------------- slide 4
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Real NASA data", Inches(0.75), Inches(0.7), Inches(8), Inches(0.8),
             size=34, bold=True)
    add_text(slide, "Not mocked: every metric comes from documented NASA datasets.",
             Inches(0.75), Inches(1.45), Inches(9), Inches(0.5), size=16, color=DIM)

    cards = [
        ("JPL Horizons (DE441)", ACCENT,
         "Topocentric Sun & Earth az/el\n10 sites × 2,928 samples\n30-min steps · Nov–Dec 2026",
         "ssd.jpl.nasa.gov/horizons"),
        ("LOLA polar DEMs (PDS)", OK,
         "LDEM_875S_20M → 74 m/px web grid\nLDEM_80S_80M → 594 m/px wide area\nPolar stereographic, R = 1,737.4 km",
         "pds-geosciences.wustl.edu"),
        ("NASA Moon Trek", WARN,
         "21 verified south-pole WMTS layers\nLOLA relief & slope · LROC imagery\nIllumination · Earth visibility · PSR · temperature",
         "trek.nasa.gov/moon"),
        ("LROC QuickMap", RGBColor(0xC0, 0x9B, 0xFF),
         "Cross-check site locations and terrain\nDeep links in the JSON mission brief",
         "quickmap.lroc.asu.edu"),
    ]
    positions = [(0.75, 2.1), (6.85, 2.1), (0.75, 4.5), (6.85, 4.5)]
    for (left, top), (title, color, body, link) in zip(positions, cards):
        add_panel(slide, Inches(left), Inches(top), Inches(5.8), Inches(2.05))
        add_text(slide, title, Inches(left + 0.25), Inches(top + 0.18), Inches(5.3), Inches(0.4),
                 size=17, bold=True, color=color)
        add_text(slide, body, Inches(left + 0.25), Inches(top + 0.68), Inches(5.3), Inches(0.95),
                 size=12.5, color=TEXT)
        add_text(slide, link, Inches(left + 0.25), Inches(top + 1.66), Inches(5.3), Inches(0.3),
                 size=11, color=DIM)
    add_notes(slide, "NASA data and its real role: Horizons for Sun/Earth geometry, LOLA for "
                     "terrain/horizon, Moon Trek for layers, QuickMap for cross-checks. "
                     "Global Awards requirement: at least one NASA resource from the challenge, explained.")
    add_footer(slide, 4)

    # ---------------------------------------------------------------- slide 5
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Demo evidence", Inches(0.75), Inches(0.55), Inches(8), Inches(0.7),
             size=30, bold=True)
    if shot_3d.exists():
        add_cover_image(slide, shot_3d, Inches(0.55), Inches(1.35), Inches(7.9), Inches(5.4))
    add_panel(slide, Inches(8.75), Inches(1.35), Inches(4.0), Inches(5.4))
    add_text(slide, "Shackleton rim", Inches(9.0), Inches(1.55), Inches(3.5), Inches(0.4),
             size=17, bold=True, color=ACCENT)
    add_text(slide, "14 Nov 2026 · 12:00 UTC", Inches(9.0), Inches(1.95), Inches(3.5), Inches(0.3),
             size=11, color=DIM)
    rows = [
        ("Sun elevation", "1.58°"),
        ("Terrain horizon", "−1.05°"),
        ("Margin", "+2.63° · visible"),
        ("Earth elevation", "−4.37° · below horizon"),
        ("Sunset", "No event in window"),
        ("Earthset", "15 d 22 h 41 min"),
        ("Ray tracing", "Clear line of sight"),
    ]
    y = 2.45
    for label, value in rows:
        add_text(slide, label, Inches(9.0), Inches(y), Inches(1.6), Inches(0.3),
                 size=11.5, color=DIM)
        add_text(slide, value, Inches(10.55), Inches(y), Inches(2.05), Inches(0.3),
                 size=11.5, color=TEXT, align=PP_ALIGN.RIGHT)
        y += 0.45
    add_text(slide, "Autopilot ranks 10 sites · JSON brief export with QuickMap + Moon Trek links",
             Inches(8.95), Inches(6.1), Inches(3.6), Inches(0.55), size=10.5, color=OK)
    add_notes(slide, "Key demo moment: change the date and show the sunlight margin and Earth "
                     "visibility change live. Values above are from the verified build.")
    add_footer(slide, 5)

    # ---------------------------------------------------------------- slide 6
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Verified, and honest about limits",
             Inches(0.75), Inches(0.7), Inches(11), Inches(0.8), size=30, bold=True)

    add_panel(slide, Inches(0.75), Inches(1.75), Inches(5.65), Inches(4.6))
    add_text(slide, "Verified", Inches(1.0), Inches(1.95), Inches(5.1), Inches(0.4),
             size=18, bold=True, color=OK)
    add_bullets(slide, [
        "104 automated tests pass; CI green on main.",
        "Sun/Earth values cross-checked against JPL Horizons datasets.",
        "Terrain horizon includes lunar curvature and the real LOLA topography.",
        "Works without WebGL (Canvas-2D fallback) and keeps the UI responsive "
        "with a background worker.",
        "Zero console errors in the final build.",
    ], Inches(1.0), Inches(2.5), Inches(5.15), Inches(3.6), size=14)

    add_panel(slide, Inches(6.95), Inches(1.75), Inches(5.65), Inches(4.6))
    add_text(slide, "Known limitations", Inches(7.2), Inches(1.95), Inches(5.1), Inches(0.4),
             size=18, bold=True, color=WARN)
    add_bullets(slide, [
        "Ephemerides cover 2026-11-01 → 2026-12-31 (pre-computed for a static site).",
        "Terrain resolution: 74 m/px (high-res area) and 594 m/px (wide area).",
        "Power and communication models are simplified engineering estimates.",
        "Moon Trek imagery layers need network access; terrain and analysis keep working.",
        "Prototype for planning and education — not a certified mission-design tool.",
    ], Inches(7.2), Inches(2.5), Inches(5.15), Inches(3.6), size=14)
    add_notes(slide, "Be explicit about what is verified and what remains. The guide rewards "
                     "honest limitations; do not claim more than the build shows.")
    add_footer(slide, 6)

    # ---------------------------------------------------------------- slide 7
    slide = prs.slides.add_slide(blank)
    add_bg(slide)
    add_text(slide, "Impact and next step", Inches(0.75), Inches(0.7), Inches(10), Inches(0.8),
             size=34, bold=True)
    add_bullets(slide, [
        "Mission planners: re-evaluate alternative sites and dates in minutes when launch "
        "or hardware schedules shift.",
        "Educators and the public: understand why small changes make huge differences at "
        "the lunar south pole.",
        "Next: live Horizons queries, higher-resolution polar DEM, richer power/thermal "
        "models, CLPS target library, orbital-variation studies.",
    ], Inches(0.75), Inches(1.8), Inches(6.6), Inches(3.6), size=17)

    add_panel(slide, Inches(7.7), Inches(1.8), Inches(4.9), Inches(4.3))
    add_text(slide, "Try it / review it", Inches(7.95), Inches(2.05), Inches(4.4), Inches(0.4),
             size=18, bold=True, color=ACCENT)
    add_text(slide, "Repository", Inches(7.95), Inches(2.65), Inches(4.4), Inches(0.3),
             size=11, color=DIM)
    add_text(slide, "github.com/rafaa-sf/l-sea-space-apps",
             Inches(7.95), Inches(2.95), Inches(4.4), Inches(0.4), size=14, color=TEXT)
    add_text(slide, "Challenge", Inches(7.95), Inches(3.65), Inches(4.4), Inches(0.3),
             size=11, color=DIM)
    add_text(slide, "spaceappschallenge.org/2026/challenges/\nlunar-landing-site-navigator/",
             Inches(7.95), Inches(3.95), Inches(4.4), Inches(0.7), size=12, color=TEXT)
    add_text(slide, "AI-assisted build — declaration in docs/ai-usage.md",
             Inches(7.95), Inches(5.1), Inches(4.4), Inches(0.4), size=10.5, color=DIM)
    add_notes(slide, "Close: 'L-SEA turns complicated mission data into a two-minute decision.' "
                     "Point to the repository and the AI usage declaration.")
    add_footer(slide, 7)

    prs.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
