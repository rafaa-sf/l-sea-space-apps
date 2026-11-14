# NASA data pipeline (`scripts/nasa/`)

Scripts that acquire, verify and package the real NASA data used by L-SEA.
Everything they write lands in `public/data/` (browser-ready, committed) or in
a local cache outside the repository.

| Script | What it does | Output |
| --- | --- | --- |
| [`sites.mjs`](sites.mjs) | Curated south-pole POI catalogue (geometry, provenance, ephemeris config) | source of truth for the other scripts |
| [`fetch-horizons.mjs`](fetch-horizons.mjs) | JPL Horizons topocentric Sun/Earth az/el for every site, 30-minute steps, 2026-11-01 to 2026-12-31 | `public/data/ephemeris/<site-id>.json`, `index.json` |
| [`build-pois.mjs`](build-pois.mjs) | Samples each POI elevation from the LOLA web DEM grids and writes the site catalogue | `public/data/pois.json` |
| [`build-layers.mjs`](build-layers.mjs) | Verifies NASA Moon Trek WMTS layers (capabilities + a real tile + CORS) and writes the catalogue | `public/data/layers.json` |
| [`build-terrain.py`](build-terrain.py) | Converts PDS LOLA polar DEM JP2 products to browser grids (Python 3 + rasterio) | `public/data/terrain/*.{json,bin}`, `index.json` |

## Requirements

- Node.js 24 for the `.mjs` scripts (no third-party dependencies).
- Python 3 with `rasterio` only for `build-terrain.py`.

## Typical run order

```bash
node scripts/nasa/fetch-horizons.mjs          # ephemerides (skips existing files)
node scripts/nasa/build-pois.mjs              # POIs + DEM-sampled elevations
node scripts/nasa/build-layers.mjs            # live verification of Moon Trek layers
python3 scripts/nasa/build-terrain.py --jpeg2000-dir /tmp/lola --out-dir public/data/terrain
```

`fetch-horizons.mjs` is polite by design: one request at a time, 1.5 s default
delay (`--delay=<ms>`), retries on HTTP 429/5xx, and a `User-Agent` identifying
the project. It also supports `--force`, `--only=<id[,id]>` and `--dry-run`.

## Data source documentation

- Endpoints, exact queries, CORS behaviour, rate limits, provenance, licensing,
  limitations and dead ends: [`docs/data.md`](../../docs/data.md)
- Ephemeris JSON contract: [`public/data/ephemeris/README.md`](../../public/data/ephemeris/README.md)

Do not edit files under `public/data/` by hand: regenerate them with these
scripts so the provenance stays reproducible.

## Source verification

`node scripts/nasa/verify-sources.mjs` re-checks the official NASA sources and
the shipped provenance metadata: PDS LOLA products and labels (data set
`LRO-L-LOLA-4-GDR-V1.0`, scaling factor and offset), JPL Horizons, NASA Moon
Trek, LROC QuickMap, and that no non-NASA ephemeris library is used. Requires
network access; exits non-zero on any failure.
