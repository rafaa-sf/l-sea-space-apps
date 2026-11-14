# Data sources and provenance

Every dataset shipped in `public/data/` is listed here with its origin, the
processing applied, its licensing/attribution and its known limitations. All
content is in English and all values use metres, degrees and ISO-8601 UTC.

> **Rule of the project:** no invented data. Where the team could not obtain a
> product in time, the document and the final report say so explicitly instead
> of filling the gap with synthetic numbers. The only synthetic data in the
> repository is the explicit UI *placeholder* fallback in
> `src/components/composables/useData.js`, which is labelled as such in the app
> and never written to `public/data/`.

## 1. Inventory

| Path | What it is | Size |
| --- | --- | --- |
| `public/data/pois.json` | 10 curated lunar south-pole sites of interest | ~8 KB |
| `public/data/layers.json` | 21 verified NASA Moon Trek WMTS layers + provenance | ~36 KB |
| `public/data/ephemeris/index.json` | index of ephemeris files, range and cadence | ~1.5 KB |
| `public/data/ephemeris/<site-id>.json` | 10 files x 2 928 samples of topocentric Sun/Earth az/el | ~2.8 MB total |
| `public/data/ephemeris/README.md` | exact JSON shape and semantics | ~6 KB |
| `public/data/terrain/index.json` | terrain regions, projection, default region | ~1.5 KB |
| `public/data/terrain/south-pole-875s-20m.{json,bin}` | 2048 x 2048 LOLA DEM grid, 74.06 m/px | 8.4 MB bin |
| `public/data/terrain/south-pole-80s-80m.{json,bin}` | 1024 x 1024 LOLA DEM grid, 593.75 m/px | 2.1 MB bin |
| **Total** | | **~13 MB** (11 MB terrain) |

## 2. Ephemerides — JPL Horizons (DE441)

**Source:** NASA/JPL Horizons API, <https://ssd.jpl.nasa.gov/horizons/>,
queried as documented in [api-integrations.md](api-integrations.md).

**What it is:** apparent topocentric azimuth/elevation of the **Sun** (NAIF 10)
and the **Earth** (NAIF 399) for an observer at each POI on the Moon, computed by
Horizons from the DE441 planetary ephemeris, with the centre at
`coord@301` (the Moon) and **airless** (no atmospheric refraction — the Moon has
no atmosphere).

**Processing:** no post-processing of the physical values. The script only
converts the Horizons CSV rows to JSON, rounds az/el to 3 decimals and merges
the Sun and Earth rows by matching timestamps.

- Script: [`scripts/nasa/fetch-horizons.mjs`](../scripts/nasa/fetch-horizons.mjs)
- Sites: [`scripts/nasa/sites.mjs`](../scripts/nasa/sites.mjs)
- Range: **2026-11-01T00:00:00Z → 2026-12-31T23:30:00Z**, step **30 min**,
  **2 928 samples** per site, no gaps.
- Why this window: it covers the Artemis-era landing window used for the demo
  and a full lunar day (29.5 Earth days) more than twice, so day/night,
  Sun-rise/set and Earth-visibility behaviour is represented without
  extrapolation.

**Verification performed:**

| Check | Result |
| --- | --- |
| Rows per site/body | 2 928 (matches the requested range exactly) |
| Time continuity | 0 gaps, first/last stamps match the range |
| Non-finite values | 0 |
| Sun elevation at Shackleton rim (89.78S) | +0.99 deg to +1.75 deg — never sets in the window (peak-of-eternal-light behaviour) |
| Sun elevation at Nobile rim 2 (83.90S) | -4.64 deg to +7.65 deg — rises and sets as expected this far from the pole |
| Earth elevation range | about -7.4 deg to +10.3 deg, consistent with lunar libration in latitude |
| Azimuth range | full 0-360 deg sweep at all sites |

**Limitations:**

- 30-minute sampling plus linear interpolation is used by the app; the
  interpolation error for Sun/Earth elevation is well below the terrain-driven
  horizon uncertainty (the Sun moves ~0.5 deg/hour in azimuth near the pole but
  its **elevation** changes by only ~0.03 deg/hour, which is the quantity that
  matters for sunrise/sunset).
- Horizons gives the *free-space* direction to each body; local terrain
  occlusion is deliberately **not** included here. The app computes it from the
  LOLA DEM (`src/core/engine.js`), which is the point of the tool.
- Earth position is topocentric apparent; the ~1.3 s one-way light time is
  included by Horizons in the apparent position and is irrelevant at this
  precision.

**Attribution:** Courtesy NASA/JPL-Caltech. Horizons / DE441.

## 3. Points of interest — curated coordinates

`public/data/pois.json` is a plain array of 10 sites (shape accepted by the
loaders; see `src/components/composables/useData.js`):

```json
{
  "id": "shackleton-rim",
  "name": "Shackleton crater rim",
  "lat": -89.78,
  "lon": 204.27,
  "elevationM": 1734,
  "perimeterM": 200,
  "mastM": 10,
  "source": "poi",
  "provenance": "Shackleton rim S, highly illuminated point of Mazarico et al. (2011), coordinates tabulated by the Orrery Space landing-site catalogue",
  "sourceUrl": "https://orreryspace.com/landing-sites/shackleton-rim-s/",
  "elevationSource": "LOLA ldem_875s_20m.jp2 sampled at the site on the 2048x2048 app grid (74.0625 m/px)",
  "terrainRegion": "south-pole-875s-20m",
  "description": "Highest-illumination point on the Shackleton crater rim; ..."
}
```

`source` is the domain enum (`'poi'`), while `provenance`/`sourceUrl` carry the
citation. Elevations are **not** hand-written: `scripts/nasa/build-pois.mjs`
bilinearly samples them from the same LOLA grids the app uses, so a site's
elevation and the terrain used for its horizon profile agree.

### Coordinate table

Longitude is **east longitude in 0-360 deg** (IAU / Moon 2000). Latitudes are
negative south.

| ID | Site | Lat | Lon | Elev. (m) | Coordinate source |
| --- | --- | --- | --- | --- | --- |
| `shackleton-rim` | Shackleton crater rim | -89.78 | 204.27 | 1734 | Shackleton rim S, highly illuminated point of Mazarico et al. (2011) (tabulated by Orrery Space) |
| `peak-near-shackleton` | Peak near Shackleton | -89.01701 | 126.27302 | 1167 | Gracy & Lee (2024), LPSC LV abstract 1695 — candidate Artemis III landing site |
| `connecting-ridge` | Connecting Ridge | -89.45 | 222.69 | 1954 | Connecting Ridge CR1, most-illuminated point of Mazarico et al. (2011) (tabulated by Orrery Space) |
| `de-gerlache-rim-1` | de Gerlache rim 1 | -88.68 | 292.07 | 1797 | Centre of the NASA Artemis III site mosaic `Site11_final_adj_5mpp_ColorHillshade`, derived from its WMTS bounding box |
| `de-gerlache-rim-2` | de Gerlache rim 2 | -88.45 | 292.1409 | 1578 | Wueller et al. (2026) candidate landing site dGR2_K2023 (tabulated by Orrery Space) |
| `haworth` | Haworth | -86.70 | 336.30 | 1512 | LROC mosaic centre of the Artemis III "Haworth" region (Orrery Space) |
| `malapert-massif` | Malapert Massif | -86.00 | 0.30 | 4810 | LROC mosaic centre of the Artemis III "Malapert Massif" region (Orrery Space) |
| `leibnitz-beta` | Leibnitz Beta plateau | -85.42 | 31.74 | 6415 | Centre of the NASA Artemis III site mosaic `Site20_final_adj_5mpp_ClrHillshade_SP`, derived from its WMTS bounding box |
| `nobile-rim-1` | Nobile rim 1 | -85.295 | 36.9168 | 6747 | Wueller et al. (2026) candidate landing site NR101 (tabulated by Orrery Space) |
| `nobile-rim-2` | Nobile rim 2 | -83.90 | 58.70 | 943 | LROC mosaic centre of the Artemis III "Nobile Rim 2" region (Orrery Space) |

Primary sources for the Orrery Space coordinates are the peer-reviewed papers
cited on each site page (Mazarico et al. 2011; Gracy & Lee 2024; Wueller et al.
2026). The two `derived` sites are computed by L-SEA from the official NASA
Artemis III site mosaics served by Moon Trek, using the same spherical polar
stereographic formulas as the DEM grids.

### Cross-check of the coordinate derivation

The Moon Trek WMTS bounding boxes are in polar stereographic metres. Converting
the box centre with `lon = atan2(x, y)`, `lat = 2*atan(rho/(2R)) - pi/2` and
comparing with independently published positions:

| Site | L-SEA from Moon Trek bbox | Independent published value | Difference |
| --- | --- | --- | --- |
| Nobile rim 1 (Site06) | 85.43S, 37.4E | 85.295S, 36.917E (Orrery / Wueller 2026) | ~5 km |
| Nobile rim 2 (DM2) | 83.95S, 58.8E | 83.90S, 58.70E (Orrery) | ~2 km |
| Connecting Ridge (Site01) | 89.46S, 222.5E | 89.45S, 222.69E (Orrery / Mazarico 2011) | < 1 km |
| Malapert Massif (Site23) | 86.0S, 359.8E | 86.0S, 0.3E (Orrery) | ~1 km |

The agreement validates both the projection convention and the derived values.
The remaining difference is the expected offset between a region centre and a
specific published candidate landing site.

### Limitations and honest caveats

- "de Gerlache rim 1" and "Leibnitz Beta plateau" are **region/mosaic centres**,
  not specific published landing spots, because no openly licensed exact
  candidate coordinate was found for them in the time available. This is
  documented rather than hidden, and both are real NASA Artemis III site
  footprints.
- `perimeterM` (200 m) and `mastM` (10 m) are **mission-profile defaults** from
  the architecture document, not observed quantities; the user can change them
  in the UI/autopilot model.
- Elevations sampled from the 594 m/px wide-area grid (outer sites) can differ
  from higher-resolution studies by a few hundred metres (e.g. Malapert Massif
  is 4 810 m here vs ~4 990 m quoted in some papers, because this is a 594 m/px
  sample relative to the 1737.4 km reference sphere, not a geoid).

## 4. Terrain — LOLA polar DEMs (PDS Geosciences)

**Source:** NASA LRO LOLA gridded data records, PDS Geosciences Node
(`LRO-L-LOLA-4-GDR-V1.0`), product directory
<https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/>.

| Product | File | Native grid | Coverage | Web output |
| --- | --- | --- | --- | --- |
| LDEM_875S_20M | `polar/jp2/ldem_875s_20m.jp2` (21.5 MB) | 7584 x 7584 int16, 20 m/px | 87.5S-90S | `south-pole-875s-20m`, 2048 x 2048, 74.06 m/px |
| LDEM_80S_80M | `polar/jp2/ldem_80s_80m.jp2` (29.8 MB) | 7600 x 7600 int16, 80 m/px | 80S-90S | `south-pole-80s-80m`, 1024 x 1024, 593.75 m/px |

**Raw conventions:** polar stereographic, latitude of origin -90, central
meridian 0, spherical `R = 1737400 m`; `SAMPLE_TYPE = LSB_INTEGER`,
`SAMPLE_BITS = 16`, `SCALING_FACTOR = 0.5`, `OFFSET = 1737400`. Values are
**shape (radius) relative to the 1737.4 km reference sphere**, not a
geopotential-referenced elevation — the app documents this datum.
PDS label example: `polar/img/ldem_80s_80m.lbl`.

**Processing:** [`scripts/nasa/build-terrain.py`](../scripts/nasa/build-terrain.py)
(Python 3 + rasterio) reads the JP2 products, applies the 0.5 m/DN scale factor,
resamples each region to a browser-sized grid, writes little-endian int16
metres plus JSON metadata and a shared `terrain/index.json` with the projection
formulas. The web grid is a **square polar-stereographic grid**, not a lat/lon
grid: row 0 is the north (max Y) edge, columns increase with X, pixel sizes are
74.0625 m and 593.75 m. `src/core/terrain.js` and `src/render/geo.js` convert
lat/lon to/from the grid.

**Measured elevation ranges of the web grids:**

| Region | Min | Max |
| --- | --- | --- |
| south-pole-875s-20m | -4 378 m | +2 369 m |
| south-pole-80s-80m | -7 274 m | +7 001 m |

These are consistent with the PDS products (LOLA radii relative to 1737.4 km).

**Attribution:** NASA/GSFC/LOLA (PDS Geosciences Node).

**Limitations:**

- The web grids are downsampled (74 m/px and 594 m/px). They are appropriate for
  horizon/visibility geometry at km scale, not for landing-hazard assessment.
- The far-field 594 m/px grid is used for sites north of 87.5S (Malapert,
  Leibnitz Beta, Nobile rims, Haworth); horizon angles for those sites are
  coarser than for the inner sites.
- PDS `.img` products were also downloaded during research
  (`LDEM_80S_80M.IMG`, 115.5 MB) but the JP2 versions were preferred as the
  conversion input because they are 4-5x smaller; both are the same data.
- No shape-from-shading or NAC photogrammetry DEMs (5 m/px site products exist
  as imagery on Moon Trek but not as open elevation grids) were merged.

## 5. Layer catalogue — NASA Moon Trek

`public/data/layers.json` contains 21 WMTS layers, each **verified live**:
capabilities parsed, tile requested with an `Origin` header, image content type
and CORS header recorded. The layers cover LOLA relief (5/30/100 m), LROC WAC
and NAC mosaics, LOLA slope, LOLA Earth-visibility, WAC illumination percentage,
permanently shadowed regions, Diviner surface temperature, and the 10 official
Artemis III 5 m/px site mosaics.

- Generation/verification: [`scripts/nasa/build-layers.mjs`](../scripts/nasa/build-layers.mjs)
- Service: <https://trek.nasa.gov/> (CORS `*`; see [api-integrations.md](api-integrations.md))
- Attribution: **NASA/GSFC/ASU — Moon Trek**, LRO/LOLA/LROC teams.

## 6. Licensing and attribution summary

| Data | Rights | Attribution used |
| --- | --- | --- |
| LRO LOLA DEMs (PDS) | NASA data, public domain / not copyrighted; NASA does not endorse derived products | "NASA/GSFC/LOLA (PDS Geosciences Node)" |
| JPL Horizons ephemerides | NASA/JPL-Caltech; free for use with attribution | "Courtesy NASA/JPL-Caltech (DE441)" |
| Moon Trek tiles and catalogue | NASA/GSFC/ASU service; NASA data | "NASA/GSFC/ASU — Moon Trek (trek.nasa.gov)" |
| LROC QuickMap links | NASA/GSFC/ASU; link only | "NASA/GSFC/ASU LROC QuickMap" |
| IAU names and coordinates | IAU WGCCRE, public reference data | IAU Working Group for Planetary System Nomenclature |
| Orrery Space landing-site catalogue | Third-party compilation of published positions; used for the underlying **facts** (coordinates) with citation | "coordinates tabulated by the Orrery Space landing-site catalogue" plus the primary paper on each entry |

No NASA logo, flag or mission identifier is placed in generated content; the
repository uses text attributions only. See the NASA guidelines linked from
<https://www.nasa.gov/> and the PDS data usage terms.

## 7. Pre-compute plan and reproducibility

Everything in `public/data/` is reproducible from public sources:

```bash
# 1. Ephemerides (Node 24, no dependencies; one request every 1.5 s)
node scripts/nasa/fetch-horizons.mjs --force

# 2. POIs (reads scripts/nasa/sites.mjs + the terrain grids)
node scripts/nasa/build-pois.mjs

# 3. Layer catalogue verification (live requests to Moon Trek)
node scripts/nasa/build-layers.mjs

# 4. Terrain (Python 3 + rasterio; downloads the PDS JP2 products)
python3 scripts/nasa/build-terrain.py --jpeg2000-dir /tmp/lola --out-dir public/data/terrain
```

- Source products and caches live outside the repository (e.g. `/tmp/lola`); the
  repository only contains the derived, browser-ready files.
- Rebuild cadence: ephemerides only when the mission window changes; layers when
  the catalogue is edited or a layer disappears; terrain only if the grid
  geometry changes.
- The web build (`npm run build`) simply copies `public/data/` into `dist/data/`.

## 8. What failed / alternatives investigated (evidence, not guesses)

This section exists because documenting dead ends is part of honest provenance.

| Attempt | Result | What was used instead |
| --- | --- | --- |
| Moon Trek **WMS** GetCapabilities (`/moontrek/wms?...`) | HTTP 404 — Moon Trek does not expose WMS | WMTS REST tiles (verified) |
| `PSR_SP` layer label | HTTP 404 | `LRO_LOLA_Illumination_SPole65S_240m` (verified PSR raster) |
| `A3_Named_regions_SP` as a tile layer | capabilities 404 — it is a catalog/named-regions item, not WMTS | not shipped; the app has its own POIs |
| QuickMap data API (`quickmap.lroc.asu.edu/api/...`) | host redirects to a documentation-less SPA; no documented open API found in time | link-only use (verified deep links) |
| Zenodo south-pole Shape-from-Shading dataset (README/coordinates) | HTTP 403 for the environment (traffic block) | not used |
| LOLA `.img` (uncompressed, 115.5 MB) as terrain input | valid data, but 4-5x larger than the JP2 equivalents | PDS JP2 products (same data, smaller) |
| Published coordinates for "de Gerlache rim 1" / "Leibnitz Beta" region centres | not found in openly accessible sources during the event | derived from the official NASA Artemis III site-mosaic WMTS footprints and labelled as derived |

## 9. Quality checks run before reporting

- `node scripts/nasa/fetch-horizons.mjs` — 10/10 sites, 2 928 samples each,
  zero gaps, time alignment of Sun and Earth rows enforced.
- Ephemeris statistics printed per site (Sun/Earth elevation ranges physically
  consistent with latitude and libration; azimuth sweeps full 0-360 deg).
- `node scripts/nasa/build-pois.mjs` — every site found terrain coverage and
  received a DEM-sampled elevation.
- `node scripts/nasa/build-layers.mjs` — 21/21 layers verified with real tiles
  and CORS.
- `npm run build` — the production bundle builds with the data copied into
  `dist/data/`.
