#!/usr/bin/env python3
"""Build the web terrain grids from real LOLA polar DEMs.

Sources (PDS Geosciences Node, LRO LOLA gridded data records, polar JP2):
- ldem_875s_20m.jp2 : 7584 x 7584 int16, 20 m/px, covers 87.5S-90S
- ldem_80s_80m.jp2  : 7600 x 7600 int16, 80 m/px, covers 80S-90S

Both products are polar stereographic (latitude of origin -90, central
meridian 0, R = 1737400 m), values in meters relative to the 1737400 m
reference radius.

This script downgrades each product to a web-friendly grid, writes binary
int16 + JSON metadata, and generates a terrain index:

  public/data/terrain/south-pole-875s-20m.bin   (2048x2048, ~74 m/px)
  public/data/terrain/south-pole-875s-20m.json
  public/data/terrain/south-pole-80s-80m.bin    (1024x1024, ~594 m/px)
  public/data/terrain/south-pole-80s-80m.json
  public/data/terrain/index.json

Usage:
  python3 scripts/nasa/build-terrain.py \
      --jpeg2000-dir /tmp/lola \
      --out-dir public/data/terrain
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

REFERENCE_RADIUS_M = 1_737_400

PRODUCTS = [
    {
        "id": "south-pole-875s-20m",
        "name": "Lunar south pole, 87.5S-90S (LOLA LDEM_875S_20M)",
        "sourceFile": "ldem_875s_20m.jp2",
        "size": 2048,
        "role": "high-resolution",
    },
    {
        "id": "south-pole-80s-80m",
        "name": "Lunar south pole, 80S-90S (LOLA LDEM_80S_80M)",
        "sourceFile": "ldem_80s_80m.jp2",
        "size": 1024,
        "role": "wide-area",
    },
]

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


def build_product(jp2_dir: Path, out_dir: Path, product: dict) -> dict:
    source = jp2_dir / product["sourceFile"]
    size = product["size"]

    with rasterio.open(source) as ds:
        # Source JP2 stores DNs with SCALING_FACTOR 0.5 and OFFSET 1737400 m:
        # elevation_m = raw_dn * 0.5 (meters relative to 1737400 m).
        grid = ds.read(1, out_shape=(size, size), resampling=Resampling.average)
        grid = (grid.astype("float64") * 0.5).round().astype("<i2")
        bounds = ds.bounds
        source_shape = ds.shape

    bin_name = f"{product['id']}.bin"
    meta_name = f"{product['id']}.json"
    bin_path = out_dir / bin_name
    grid.tofile(bin_path)

    pixel_size_m = (bounds.right - bounds.left) / size

    meta = {
        "id": product["id"],
        "name": product["name"],
        "role": product["role"],
        "source": (
            "NASA LRO LOLA polar gridded product, PDS Geosciences Node "
            "(lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2)"
        ),
        "sourceFile": product["sourceFile"],
        "sourceShape": {"width": int(source_shape[1]), "height": int(source_shape[0])},
        "referenceRadiusM": REFERENCE_RADIUS_M,
        "datumNote": (
            "Elevation values are meters relative to the 1737400 m reference "
            "radius (LOLA shape model). Source DNs have SCALING_FACTOR 0.5; "
            "this grid stores elevation in meters (1 m resolution) already scaled."
        ),
        "projection": PROJECTION,
        "grid": {
            "width": size,
            "height": size,
            "pixelSizeM": round(pixel_size_m, 4),
            "minX": float(bounds.left),
            "maxX": float(bounds.right),
            "minY": float(bounds.bottom),
            "maxY": float(bounds.top),
            "rowOrder": "row 0 = maxY (north edge), increasing row = decreasing y",
            "colOrder": "col 0 = minX (west edge), increasing col = increasing x",
            "dtype": "int16",
            "endianness": "little",
            "layout": "row-major",
            "file": bin_name,
            "fileBytes": int(bin_path.stat().st_size),
        },
        "elevationRangeM": [int(grid.min()), int(grid.max())],
        "attribution": "NASA/GSFC/LOLA (PDS Geosciences Node)",
    }

    (out_dir / meta_name).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(
        f"wrote {bin_name}: {size}x{size}, {pixel_size_m:.2f} m/px, "
        f"bounds ±{max(abs(bounds.left), abs(bounds.right)):.0f} m, "
        f"elevation {meta['elevationRangeM']} m"
    )

    return {
        "id": product["id"],
        "role": product["role"],
        "meta": meta_name,
        "bin": bin_name,
        "width": size,
        "height": size,
        "pixelSizeM": meta["grid"]["pixelSizeM"],
        "boundsM": {
            "minX": meta["grid"]["minX"],
            "maxX": meta["grid"]["maxX"],
            "minY": meta["grid"]["minY"],
            "maxY": meta["grid"]["maxY"],
        },
        "elevationRangeM": meta["elevationRangeM"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jpeg2000-dir", default="/tmp/lola")
    parser.add_argument("--out-dir", default="public/data/terrain")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    jp2_dir = Path(args.jpeg2000_dir)

    regions = [build_product(jp2_dir, out_dir, p) for p in PRODUCTS]

    index = {
        "id": "lunar-south-pole-terrain",
        "referenceRadiusM": REFERENCE_RADIUS_M,
        "projection": PROJECTION,
        "defaultRegionId": "south-pole-875s-20m",
        "regions": regions,
        "attribution": "NASA/GSFC/LOLA (PDS Geosciences Node)",
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"wrote index.json with {len(regions)} regions")


if __name__ == "__main__":
    main()
