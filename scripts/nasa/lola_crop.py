#!/usr/bin/env python3
"""Crop and resample one PDS Geosciences LOLA polar JP2 DEM into a web terrain grid.

Called by ``scripts/nasa/download-lola.mjs`` after the JP2 product has been
downloaded and verified. Uses rasterio windowed reads so arbitrary extents are
supported without loading the whole mosaic, and follows exactly the same
metadata/projection conventions as ``scripts/nasa/build-terrain.py``:

- source values are QDs with SCALING_FACTOR 0.5 (metres relative to 1737400 m)
- average resampling, little-endian int16, row-major, row 0 = maxY
- metadata JSON with the same fields and key order as the committed grids

Usage (normally through download-lola.mjs):

  python3 scripts/nasa/lola_crop.py \
    --source .cache/lola/ldem_80s_80m.jp2 \
    --out-bin /tmp/lola/custom-400km-1024px.bin \
    --out-meta /tmp/lola/custom-400km-1024px.json \
    --id custom-400km-1024px \
    --name "Custom LOLA south-pole terrain, 400 km at 1024 px" \
    --role custom \
    --size 1024 \
    --min-x -200000 --min-y -200000 --max-x 200000 --max-y 200000

Prints one JSON summary line on stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

REFERENCE_RADIUS_M = 1_737_400
SCALING_FACTOR = 0.5

SOURCE_DESCRIPTION = (
    "NASA LRO LOLA polar gridded product, PDS Geosciences Node "
    "(lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2)"
)
DATUM_NOTE = (
    "Elevation values are meters relative to the 1737400 m reference "
    "radius (LOLA shape model). Source DNs have SCALING_FACTOR 0.5; "
    "this grid stores elevation in meters (1 m resolution) already scaled."
)

PROJECTION = {
    "type": "polar_stereographic",
    "latitudeOfOriginDeg": -90,
    "centralMeridianDeg": 0,
    "referenceRadiusM": REFERENCE_RADIUS_M,
    "formula": {
        "lonLatToXY": (
            "rho = 2 * R * tan(pi/4 + lat/2); x = rho * sin(lon); "
            "y = rho * cos(lon)"
        ),
        "xyToLonLat": (
            "rho = hypot(x, y); lon = atan2(x, y); "
            "lat = 2 * atan(rho / (2 * R)) - pi/2"
        ),
        "units": "meters for x/y, radians inside formulas",
    },
}


def fail(message: str):
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crop and resample a LOLA polar JP2 DEM")
    parser.add_argument("--source", required=True, help="path to the source .jp2")
    parser.add_argument("--out-bin", required=True, help="output .bin path")
    parser.add_argument("--out-meta", required=True, help="output .json metadata path")
    parser.add_argument(
        "--bin-name",
        default=None,
        help="file name recorded in the metadata grid (defaults to the out-bin basename)",
    )
    parser.add_argument("--id", required=True, help="region id")
    parser.add_argument("--name", required=True, help="human-readable region name")
    parser.add_argument("--role", required=True, help="high-resolution | wide-area | custom")
    parser.add_argument("--size", required=True, type=int, help="output grid size in pixels (square)")
    parser.add_argument("--min-x", type=float, default=None, help="extent min X in projected metres")
    parser.add_argument("--min-y", type=float, default=None, help="extent min Y in projected metres")
    parser.add_argument("--max-x", type=float, default=None, help="extent max X in projected metres")
    parser.add_argument("--max-y", type=float, default=None, help="extent max Y in projected metres")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Path(args.source)
    if not source.is_file():
        fail(f"source product not found: {source}")
    if args.size < 2:
        fail("--size must be at least 2 pixels")
    if args.role not in ("high-resolution", "wide-area", "custom"):
        fail("--role must be high-resolution, wide-area or custom")

    with rasterio.open(source) as ds:
        if ds.driver not in ("JP2OpenJPEG", "JP2ECW", "PNG", "GTiff"):
            fail(f"unsupported source driver: {ds.driver}")
        b = ds.bounds
        extent_given = any(v is not None for v in (args.min_x, args.min_y, args.max_x, args.max_y))
        if extent_given:
            if None in (args.min_x, args.min_y, args.max_x, args.max_y):
                fail("all of --min-x, --min-y, --max-x, --max-y must be provided together")
            min_x, min_y, max_x, max_y = args.min_x, args.min_y, args.max_x, args.max_y
        else:
            min_x, min_y, max_x, max_y = float(b.left), float(b.bottom), float(b.right), float(b.top)

        # Validate the requested extent.
        if not (min_x < max_x and min_y < max_y):
            fail("extent must satisfy minX < maxX and minY < maxY")
        width_m = max_x - min_x
        height_m = max_y - min_y
        if abs(width_m - height_m) > 1e-6 * max(width_m, height_m):
            fail(f"extent must be square (got {width_m:.3f} x {height_m:.3f} m); use --extent-km")
        tolerance = 1e-3
        if (
            min_x < b.left - tolerance
            or min_y < b.bottom - tolerance
            or max_x > b.right + tolerance
            or max_y > b.top + tolerance
        ):
            fail(
                f"extent [{min_x:.1f},{min_y:.1f},{max_x:.1f},{max_y:.1f}] is outside the "
                f"source coverage [{b.left:.1f},{b.bottom:.1f},{b.right:.1f},{b.top:.1f}]"
            )

        full_extent = (
            abs(min_x - b.left) < 1e-9
            and abs(min_y - b.bottom) < 1e-9
            and abs(max_x - b.right) < 1e-9
            and abs(max_y - b.top) < 1e-9
        )
        if full_extent:
            # Same call as build-terrain.py, so regenerated standard regions stay
            # byte-identical to the committed grids.
            raw = ds.read(1, out_shape=(args.size, args.size), resampling=Resampling.average)
        else:
            window = from_bounds(min_x, min_y, max_x, max_y, transform=ds.transform)
            raw = ds.read(
                1,
                window=window,
                out_shape=(args.size, args.size),
                resampling=Resampling.average,
            )
            # The window is derived exactly from the requested extent; metadata
            # keeps the requested bounds (clean values for the UI and the index).
        source_shape = ds.shape

    grid = (raw.astype("float64") * SCALING_FACTOR).round().astype("<i2")
    if grid.size != args.size * args.size:
        fail(f"unexpected grid size {grid.size}, expected {args.size ** 2}")

    out_bin = Path(args.out_bin)
    out_meta = Path(args.out_meta)
    bin_name = args.bin_name or out_bin.name
    out_bin.parent.mkdir(parents=True, exist_ok=True)
    grid.tofile(out_bin)

    pixel_size_m = (max_x - min_x) / args.size
    meta = {
        "id": args.id,
        "name": args.name,
        "role": args.role,
        "source": SOURCE_DESCRIPTION,
        "sourceFile": source.name,
        "sourceShape": {"width": int(source_shape[1]), "height": int(source_shape[0])},
        "referenceRadiusM": REFERENCE_RADIUS_M,
        "datumNote": DATUM_NOTE,
        "projection": PROJECTION,
        "grid": {
            "width": args.size,
            "height": args.size,
            "pixelSizeM": round(pixel_size_m, 4),
            "minX": float(min_x),
            "maxX": float(max_x),
            "minY": float(min_y),
            "maxY": float(max_y),
            "rowOrder": "row 0 = maxY (north edge), increasing row = decreasing y",
            "colOrder": "col 0 = minX (west edge), increasing col = increasing x",
            "dtype": "int16",
            "endianness": "little",
            "layout": "row-major",
            "file": bin_name,
            "fileBytes": int(out_bin.stat().st_size),
        },
        "elevationRangeM": [int(grid.min()), int(grid.max())],
        "attribution": "NASA/GSFC/LOLA (PDS Geosciences Node)",
    }
    out_meta.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "id": args.id,
                "bin": str(out_bin),
                "meta": str(out_meta),
                "width": args.size,
                "height": args.size,
                "pixelSizeM": meta["grid"]["pixelSizeM"],
                "boundsM": {
                    "minX": meta["grid"]["minX"],
                    "maxX": meta["grid"]["maxX"],
                    "minY": meta["grid"]["minY"],
                    "maxY": meta["grid"]["maxY"],
                },
                "elevationRangeM": meta["elevationRangeM"],
                "sourceFile": source.name,
            }
        )
    )


if __name__ == "__main__":
    main()
