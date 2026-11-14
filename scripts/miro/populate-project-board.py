#!/usr/bin/env python3
"""Populate the shared Miro project board for L-SEA Space Apps.

Reads MIRO_ACCESS_TOKEN from the repository-root .env (gitignored) and builds
the project board: title, five section frames and their sticky notes.

Usage:
    python3 scripts/miro/populate-project-board.py [--board <board-id>]

The script is idempotent-ish: it deletes the section frames it finds by title
before recreating them, so it can be re-run to refresh the board.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BOARD = "uXjVEOehZeI="
API = "https://api.miro.com/v2"

TITLE = "L-SEA Space Apps · Málaga 2026"
SUBTITLE = "Lunar Landing Site Navigator · NASA Space Apps Challenge · 14–15 Nov 2026"
REPO = "github.com/rafaa-sf/l-sea-space-apps"

SECTIONS = [
    {
        "title": "01 · Problem",
        "color": "red",
        "notes": [
            "At the Moon's south pole, small changes in site or date flip sunlight and Earth visibility.",
            "Power and direct-to-Earth comms depend on the Sun and Earth relative to the terrain horizon.",
            "Data exists (QuickMap, Moon Trek, Horizons) but the tools are built for detailed analysis.",
            "Gap: no intuitive tool for rapid site–date comparison.",
        ],
    },
    {
        "title": "02 · Solution",
        "color": "light_blue",
        "notes": [
            "1. Select site: 10 POIs, custom coordinates, or map pointer.",
            "2. Choose a date inside the mission window.",
            "3. See Sun and Earth against the ray-traced terrain horizon (lunar curvature).",
            "4. Compare sites and dates; autopilot ranks them.",
            "3D terrain + Canvas-2D fallback; English and Spanish UI.",
            "JSON mission brief export with NASA source links.",
        ],
    },
    {
        "title": "03 · NASA data",
        "color": "light_green",
        "notes": [
            "JPL Horizons DE441: topocentric Sun/Earth az-el, 10 sites × 2,928 samples, 30-min steps, Nov–Dec 2026.",
            "LOLA DEMs (PDS): 74 m/px high-resolution area + 594 m/px wide area, polar stereographic.",
            "Moon Trek: 21 verified south-pole WMTS layers (relief, slope, imagery, illumination, PSR, temperature).",
            "QuickMap: cross-check site locations and terrain; deep links in the brief.",
            "Challenge NASA resource explained → Global Awards eligible.",
        ],
    },
    {
        "title": "04 · Evidence",
        "color": "light_yellow",
        "notes": [
            "Shackleton rim · 2026-11-14 12:00 UTC: Sun el 1.58° vs terrain horizon −1.05° → +2.63° margin, visible.",
            "Earth el −4.37° → below the horizon.",
            "Sunset: no event in the mission window · Earthset: 15 d 22 h 41 min.",
            "Ray tracing: clear line of sight to space.",
            "Autopilot ranks 10 sites; brief exports with QuickMap + Moon Trek + Horizons + LOLA links.",
        ],
    },
    {
        "title": "05 · Status & next steps",
        "color": "light_pink",
        "notes": [
            "Code, data and docs merged on main (e521271); CI green.",
            "Release: 104 app tests + 8 MCP tests passing.",
            "Deploy target: Vercel (static build).",
            "Project Demo: 7-slide deck ready → publish public link.",
            "Next: Submit for Judging before Sunday 23:59 local time.",
            "Team: primary + commercial machines; repo coordination via lock/* tags.",
        ],
    },
]

FRAME_W, FRAME_H = 700, 900
FRAME_GAP = 900  # center-to-center distance
STICKY_COLS = [170, 530]
STICKY_ROWS = [120, 300, 480, 660]


def token() -> str:
    env = (ROOT / ".env").read_text(encoding="utf-8")
    match = re.search(r"^MIRO_ACCESS_TOKEN=(.+)$", env, re.M)
    if not match:
        sys.exit("MIRO_ACCESS_TOKEN not found in .env")
    return match.group(1).strip()


class Miro:
    def __init__(self, token_value: str, board_id: str) -> None:
        self.token = token_value
        self.board = board_id

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{API}/boards/{urllib.parse.quote(self.board, safe='')}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read().decode()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode()
            raise SystemExit(f"Miro API {method} {path} failed: {error.code} {detail}") from error

    def list_items(self) -> list[dict]:
        items: list[dict] = []
        cursor = None
        while True:
            query = "/items?limit=50" + (f"&cursor={cursor}" if cursor else "")
            page = self.request("GET", query)
            items.extend(page.get("data") or [])
            cursor = page.get("cursor")
            if not cursor:
                return items

    def delete(self, item_id: str) -> None:
        url = (
            f"{API}/boards/{urllib.parse.quote(self.board, safe='')}"
            f"/items/{urllib.parse.quote(item_id, safe='')}"
        )
        req = urllib.request.Request(url, method="DELETE")
        req.add_header("Authorization", f"Bearer {self.token}")
        try:
            urllib.request.urlopen(req, timeout=30).read()
        except urllib.error.HTTPError as error:
            if error.code not in (400, 404):
                detail = error.read().decode()
                raise SystemExit(f"delete {item_id} failed: {error.code} {detail}") from error

    def create_frame(self, x: float, y: float, title: str, color: str) -> dict:
        return self.request(
            "POST",
            "/frames",
            {
                "data": {"title": title, "format": "custom"},
                "style": {"fillColor": "#161a24"},
                "position": {"x": x, "y": y},
                "geometry": {"width": FRAME_W, "height": FRAME_H},
            },
        )

    def create_sticky(self, content: str, x: float, y: float, frame_id: str, color: str) -> dict:
        return self.request(
            "POST",
            "/sticky_notes",
            {
                "data": {"content": content, "shape": "square"},
                "style": {"fillColor": color, "textAlign": "left"},
                "position": {"x": x, "y": y, "origin": "center"},
                "parent": {"id": frame_id},
            },
        )

    def create_text(self, content: str, x: float, y: float, size: int, color: str = "#e8ecf4") -> dict:
        return self.request(
            "POST",
            "/texts",
            {
                "data": {"content": content},
                "style": {"fontSize": size, "color": color, "textAlign": "center"},
                "position": {"x": x, "y": y, "origin": "center"},
                "geometry": {"width": 2400},
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--board", default=DEFAULT_BOARD)
    args = parser.parse_args()

    miro = Miro(token(), args.board)

    existing = miro.list_items()
    for item in existing:
        item_type = (item.get("type") or "").lstrip("!") if isinstance(item.get("type"), str) else ""
        title = (item.get("data") or {}).get("title") or ""
        if item_type == "frame" and title in {section["title"] for section in SECTIONS}:
            miro.delete(item["id"])
    # Remove any pre-existing title texts from earlier runs.
    for item in existing:
        if item.get("type") == "text":
            content = (item.get("data") or {}).get("content") or ""
            if TITLE in content or SUBTITLE in content or REPO in content:
                miro.delete(item["id"])

    total_frames = len(SECTIONS)
    start_x = -(total_frames - 1) * FRAME_GAP / 2
    miro.create_text(TITLE, 0, -1360, 96)
    miro.create_text(SUBTITLE, 0, -1230, 32, "#9aa4b8")
    miro.create_text(REPO, 0, 340, 28, "#6ea8ff")

    for index, section in enumerate(SECTIONS):
        frame = miro.create_frame(start_x + index * FRAME_GAP, -600, section["title"], section["color"])
        frame_id = frame["id"]
        notes = section["notes"]
        for position, note in enumerate(notes):
            column = position % 2
            row = position // 2
            if row >= len(STICKY_ROWS):
                break
            miro.create_sticky(
                note,
                STICKY_COLS[column],
                STICKY_ROWS[row],
                frame_id,
                section["color"],
            )
        print(f"frame {section['title']}: {min(len(notes), len(STICKY_COLS) * len(STICKY_ROWS))} notes")

    print(f"done — board: https://miro.com/app/board/{args.board}")


if __name__ == "__main__":
    main()
