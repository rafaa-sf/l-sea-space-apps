# Data sources, endpoints and provenance

Every NASA dataset shipped in `public/data/`, the exact endpoints used, their CORS
behaviour, rate limits, licensing and known limitations.

> **Verification status:** every endpoint and query below was executed against the
> live service during the hackathon (14 November 2026) with the scripts in
> `scripts/nasa/`. Where a service could not be used as hoped, the dead end is
> recorded in section 8 instead of being hidden.

## 1. Runtime model: static deployment, pre-computed data

The application is a **static Vite build** deployed on Vercel. There is no server
runtime, so only services that send CORS headers can be called from the browser:

| Class | Service | CORS | Runtime use |
| --- | --- | --- | --- |
| Map imagery (WMTS tiles) | NASA Moon Trek | `Access-Control-Allow-Origin: *` | called live by the browser |
| Ephemeris (Sun/Earth positions) | JPL Horizons | **no CORS header** | **pre-computed** into `public/data/ephemeris/` |
| Terrain (DEM) | PDS Geosciences LOLA | no CORS header | pre-computed into `public/data/terrain/` |
| Site coordinates | published literature and IAU naming | n/a | curated into `public/data/pois.json` |

The Vite dev server proxies `/nasa/horizons` to `https://ssd.jpl.nasa.gov` for
development experiments (`vite.config.js`); production never uses it.

## 2. JPL Horizons (ephemerides), pre-computed

**Endpoint:** `https://ssd.jpl.nasa.gov/api/horizons.api`

Horizons is the authoritative ephemeris service for solar-system bodies. L-SEA
requests the **apparent topocentric azimuth and elevation of the Sun and the Earth
from an observer standing on the Moon**, from the DE441 ephemeris.

### Query parameters

| Parameter | Value used by L-SEA | Meaning |
| --- | --- | --- |
| `format` | `text` | text response with a `$$SOE`/`$$EOE` data block |
| `COMMAND` | `'10'` (Sun) or `'399'` (Earth) | target body NAIF ID |
| `OBJ_DATA` | `NO` | omit the object data block |
| `MAKE_EPHEM` | `YES` | generate an ephemeris |
| `EPHEM_TYPE` | `OBSERVER` | observer table (azimuth/elevation) |
| `CENTER` | `'coord@301'` | observer at a user site on the **Moon** (NAIF 301) |
| `COORD_TYPE` | `'GEODETIC'` | interpret `SITE_COORD` as longitude/latitude/altitude |
| `SITE_COORD` | `'<lon>,<lat>,0'` | east longitude in degrees, latitude in degrees, altitude in km |
| `QUANTITIES` | `'4'` | apparent azimuth and elevation |
| `ANG_FORMAT` | `'DEG'` | decimal degrees |
| `CSV_FORMAT` | `'YES'` | comma-separated rows, easy to parse |
| `STEP_SIZE` | `'30m'` | 30-minute cadence |
| `TIME_ZONE` | `'0'` | UTC output |
| `START_TIME` | `'2026-Nov-01 00:00'` | UTC |
| `STOP_TIME` | `'2026-Dec-31 23:30'` | UTC |

`SITE_COORD` order is **east longitude, latitude, altitude in km**. The lunar
reference sphere used by Horizons is `R = 1737.4 km`, matching `MOON_RADIUS_M =
1737400` in the application.

### Example: Sun from the Haworth site (real request)

```bash
curl -sS "https://ssd.jpl.nasa.gov/api/horizons.api\
?format=text\
&COMMAND='10'\
&OBJ_DATA='NO'\
&MAKE_EPHEM='YES'\
&EPHEM_TYPE='OBSERVER'\
&CENTER='coord@301'\
&COORD_TYPE='GEODETIC'\
&SITE_COORD='336.30000,-86.70000,0'\
&QUANTITIES='4'\
&ANG_FORMAT='DEG'\
&CSV_FORMAT='YES'\
&STEP_SIZE='30m'\
&TIME_ZONE='0'\
&START_TIME='2026-Nov-01 00:00'\
&STOP_TIME='2026-Dec-31 23:30'"
```

Response (abridged; the full response is 153 kB):

```text
API VERSION: 1.2
Target body name: Sun (10)                        {source: DE441}
Center body name: Moon (301)                      {source: DE441}
Center geodetic : 336.3, -86.7, 0.0               {E-lon(deg),Lat(deg),Alt(km)}
Atmos refraction: NO (AIRLESS)
$$SOE
 2026-Nov-01 00:00,*,i, 308.718817,     3.523563,
 2026-Nov-01 00:30,*,i, 308.465174,     3.512356,
...
$$EOE
```

Fields after the timestamp: solar-presence marker, interferer marker, azimuth
(degrees), elevation (degrees). The parser reads fields 3 and 4 (zero-based).

### CORS status: no CORS header (verified)

A request with `Origin: http://localhost:5173` returns `HTTP 200`, `Content-Type:
text/plain` and **no `Access-Control-Allow-Origin` header**. The static production
application therefore cannot call Horizons from the browser, which is why the
ephemerides are pre-computed.

### Rate limits and etiquette

- JPL asks users to be considerate; there is no API key and no published hard quota.
  L-SEA sends **one request at a time with a 1.5 s delay** (about 0.6 requests per
  second), identifies itself in the `User-Agent` header, and retries HTTP 429/5xx
  with exponential backoff (2, 4 and 8 s; maximum four attempts).
- Results are cached in `public/data/ephemeris/` and only re-fetched with `--force`.

### Pre-computed artefacts

- Script: [`scripts/nasa/fetch-horizons.mjs`](../scripts/nasa/fetch-horizons.mjs)
- Files: `public/data/ephemeris/<site-id>.json`, `index.json`, `README.md`
- 10 sites x 2 bodies x 2,928 samples (30-minute steps) = 58,560 samples.
- JSON contract: [`public/data/ephemeris/README.md`](../public/data/ephemeris/README.md).

**Attribution:** Courtesy NASA/JPL-Caltech (ephemeris DE441).

## 3. NASA Moon Trek (WMTS map layers), used live

Moon Trek is NASA/JPL's lunar mapping portal. L-SEA uses its public OGC WMTS
services for south-polar layers: LOLA shaded relief, LROC mosaics, slope,
illumination, Earth visibility, permanently shadowed regions, Diviner temperature
and the official Artemis III site mosaics.

### Service endpoints (all verified)

| Purpose | URL |
| --- | --- |
| Layer catalogue (south-polar projection) | `https://trek.nasa.gov/moon/TrekServices/ws/index/polar/listVisibleLayers?proj=urn:ogc:def:crs:IAU2000::30120&start=0&rows=2147483647` |
| Search API (all products) | `https://trek.nasa.gov/moon/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647` |
| WMTS endpoint for one layer | `https://trek.nasa.gov/moon/TrekServices/ws/index/getLayerServices?uuid=<item_UUID>` |
| WMTS capabilities | `https://trek.nasa.gov/tiles/Moon/SP/<layerLabel>/1.0.0/WMTSCapabilities.xml` |
| Tile template | `https://trek.nasa.gov/tiles/Moon/SP/<layerLabel>/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png` |
| Layer catalogue config | `https://trek.nasa.gov/tiles/apidoc/config/config.json` |
| API documentation | `https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon` |

The catalogue query returns 347 south-polar layers as JSON (product label, title,
description, resolution, `item_UUID`, thumbnail URL). `getLayerServices?uuid=` returns
the WMTS endpoint for a product.

### Projection and tile scheme

- Projection: **IAU2000:30120**, lunar south polar stereographic (latitude of origin
  -90, central meridian 0, `R = 1737400 m`).
- Tile matrix set `default028mm`; matrix sizes start at 2 x 1 tiles at zoom 0 and
  double per level. The zoom range depends on the product (for example the 5 m/px
  LOLA layer offers zoom 0-9; site mosaics 0-10). Tiles are projected, not
  equirectangular.

### CORS status: enabled (verified)

A tile request with an `Origin` header returns `HTTP 200`,
`Access-Control-Allow-Origin: *` and `Content-Type: image/png`. The catalogue service
also returns `Access-Control-Allow-Origin: *`.

### Verified layer catalogue

[`scripts/nasa/build-layers.mjs`](../scripts/nasa/build-layers.mjs) re-verifies the
whole catalogue on demand: it fetches each layer's capabilities, reads the tile
template and zoom range, and requests a real tile with an `Origin` header before
writing `public/data/layers.json`.

| Item | Result |
| --- | --- |
| Layers defined | 21 |
| Verified (capabilities + real tile + image content type) | 21 of 21 |
| CORS header present on every tile probe | yes (`*`) |
| Known unavailable label tried | `PSR_SP` returns HTTP 404; the PSR raster is served as `LRO_LOLA_Illumination_SPole65S_240m`, which is verified and included |
| Artemis III named-region outline | `A3_Named_regions_SP` is a catalog item, not a WMTS layer (capabilities 404), so it is not in the catalogue |

Each entry in `public/data/layers.json` records the layer label, name, description,
kind, tile URL, zoom range, projection, attribution, viewer URL and the verification
record (HTTP status, CORS header, content type, byte size, probe URL, timestamp).

**Attribution:** NASA/GSFC/ASU, Moon Trek (<https://trek.nasa.gov/>), LRO/LOLA/LROC
teams. Deep links used in the exported brief follow
`https://trek.nasa.gov/moon/#/v1/115/0.5/0/<lon>/<lat>/-170.000/0.000/90.000/0/0/0`.

## 4. PDS Geosciences Node: LOLA polar DEMs, pre-computed

**Base directory:**
`https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/`

| Product | File | Size | Native grid | Coverage |
| --- | --- | --- | --- | --- |
| LDEM_875S_20M | `jp2/ldem_875s_20m.jp2` | 21.5 MB | 7584 x 7584 int16, 20 m/px | 87.5S-90S |
| LDEM_80S_80M | `jp2/ldem_80s_80m.jp2` | 29.8 MB | 7600 x 7600 int16, 80 m/px | 80S-90S |

The same products exist as uncompressed `.img` files with PDS labels in
`polar/img/`, for example `ldem_80s_80m.lbl`:

```text
DATA_SET_ID            = "LRO-L-LOLA-4-GDR-V1.0"
LINES                  = 7600
LINE_SAMPLES           = 7600
SAMPLE_TYPE            = LSB_INTEGER
SAMPLE_BITS            = 16
UNIT                   = METER
SCALING_FACTOR         = 0.5
OFFSET                 = 1737400.
MAP_PROJECTION_TYPE    = "POLAR STEREOGRAPHIC"
CENTER_LATITUDE        = -90 <deg>
CENTER_LONGITUDE       = 0 <deg>
MAP_SCALE              = 80 <m/pix>
```

`HEIGHT = DN * SCALING_FACTOR` gives metres relative to the 1737.4 km reference
sphere; `PLANETARY_RADIUS = DN * SCALING_FACTOR + OFFSET`. These are shape (radius)
values, not an elevation above a geoid.

Polar-stereographic transform used throughout the application (spherical,
`R = 1,737,400 m`, central meridian 0):

```text
lonLatToXY:  rho = 2 * R * tan(pi/4 + lat/2); x = rho * sin(lon); y = rho * cos(lon)
xyToLonLat:  rho = hypot(x, y); lon = atan2(x, y); lat = 2 * atan(rho / (2 * R)) - pi/2
grid:        col = (x - minX) / pixelSizeM; row = (maxY - y) / pixelSizeM
```

### CORS status: no CORS header (verified); irrelevant, pre-computed

The PDS file server returns the file with `accept-ranges` and `etag` headers and no
`Access-Control-Allow-Origin`. The application never fetches these files at runtime;
the build script resamples them into web grids.

### Pre-computed artefacts

- Script: [`scripts/nasa/build-terrain.py`](../scripts/nasa/build-terrain.py)
  (Python 3 with rasterio; run once locally, not part of the web build).
- Output: `public/data/terrain/`
  - `south-pole-875s-20m.json` and `.bin`: 2048 x 2048, 74.0625 m/px, int16 metres,
    bounds plus/minus 75,840 m, about 8.4 MB binary.
  - `south-pole-80s-80m.json` and `.bin`: 1024 x 1024, 593.75 m/px, int16 metres,
    bounds plus/minus 304,000 m, about 2.1 MB binary.
  - `index.json`: region list, projection description and default region.
- Format: little-endian int16, row-major, row 0 is the north (max Y) edge, values in
  metres relative to `R = 1737400 m`; no-data pixels are `-32768`.

Measured elevation ranges of the web grids: -4,378 to +2,369 m (high resolution) and
-7,274 to +7,001 m (wide area), consistent with the PDS products.

**Attribution:** NASA/GSFC/LOLA (PDS Geosciences Node), data set
`LRO-L-LOLA-4-GDR-V1.0`.

### Local DEM downloader (before the first render)

The DEM area selector is populated from `public/data/terrain/index.json`. The repository ships four extra area presets generated with this downloader (100, 200, 300 and 400 km at 1024 px) besides the two standard regions, and the selector sorts them by extent: 100 km, 152 km high detail, 200 km, 300 km, 400 km, 608 km wide area. Any additional local region created with the commands below appears in the same selector after a reload.

`scripts/nasa/download-lola.mjs` is the user-facing local download step: it
acquires the official PDS products, verifies them, caches them under
`.cache/lola/` (gitignored) and builds browser terrain regions at the size the
user wants. The application lists every region in `public/data/terrain/index.json`
in its DEM area selector, so a newly built region appears in the dropdown after
the app reloads.

| Product | URL (PDS Geosciences, `polar/jp2/`) | Size | SHA-256 |
| --- | --- | --- | --- |
| `ldem_875s_20m.jp2` | `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2/ldem_875s_20m.jp2` | 21,462,406 B | `fff7c2017a192788066a0867d78fd1ccf783216e26974b5e65287669aa472bac` |
| `ldem_80s_80m.jp2` | `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2/ldem_80s_80m.jp2` | 29,837,992 B | `c088dd4f510e879375ee7e6f0d320ba84115f535f45fb592dd7f83a7d2e83ae3` |

```bash
npm run data:lola                                   # both standard regions (2048 px / 1024 px)
npm run data:lola -- --region=high-detail --size=1024 --overwrite   # resize a committed standard region
npm run data:lola -- --product=ldem_80s_80m --mpp=250
npm run data:lola -- --extent-km=400x300 --size=1024x768
npm run data:lola -- --extent-km=400x300 --size=1024x768 --center-x=-50000 --center-y=40000
npm run data:lola -- --extent=-200000,-300000,200000,300000 --mpp=400
npm run data:lola -- --extent-km=100x60 --size=512x384 --id=custom-window
npm run data:lola -- --dry-run                      # plan only, no downloads or writes
npm run data:lola -- --region=both --force          # re-download the products
npm run data:lola -- --extent-km=400 --overwrite    # replace a changed existing region
```

- Downloads are polite (project `User-Agent`, 300 s timeout, three attempts with
  backoff) and are verified against the exact byte size and SHA-256 above before
  use; a corrupt cache file is re-downloaded automatically.
- Output follows the same contract as the committed grids: `<id>.bin` (int16
  metres, little-endian, row 0 = maxY) and `<id>.json` with the projection, grid
  `width`/`height` and bounds, built with a rasterio windowed crop and average
  resample (`scripts/nasa/lola_crop.py`).
- `index.json` is updated in place: existing regions, `defaultRegionId`,
  `projection` and `attribution` are preserved and the new or refreshed region is
  added. Standard regions regenerate **byte-identically** from the verified
  products (the two committed bins keep their SHA-256
  `146dff6a...a656dc0` and `b916c7aa...bbb6514`), so a standard run does not
  modify the committed data.
- Extents are **rectangular**: `--extent-km=WxH` (or one number for a square) or
  `--extent=minX,minY,maxX,maxY` in projected metres, with `--center-x/--center-y`
  shifting a `--extent-km` window. Output grids are `--size=WxH` (or one number)
  or `--mpp` for square pixels. Custom regions are named like
  `custom-400x300km-1024x768px` (compact `custom-400km-1024px` when both are
  square); off-pole windows add a `-cx<km>km-cy<km>km` suffix.
- The source product is selected automatically from the extent: high-detail up to
  plus/minus 75,840 m, wide area up to plus/minus 304,000 m; larger extents are
  rejected. With `--mpp`, width and height are derived from the extent so pixels
  stay square.
- Custom index entries also carry `boundsM.lower` and `boundsM.upper` corner
  strings (`"minX minY"`, `"maxX maxY"`) next to the numeric bounds, because the
  application's DEM selector uses them to label non-standard regions with their
  window size (for example "Custom 400 x 300 km at 391 m/px").
- Rectangular grids may have square pixels (the preferred case: `--mpp`, or a
  `--size` whose aspect matches the extent such as 400x300 km at 1024x768) or
  non-square pixels (for example 200x350 km at 800x700). Custom metadata and
  index entries then record `pixelSizeXM` and `pixelSizeYM` next to
  `pixelSizeM` (the x-axis size) and a `squarePixels` flag. The analysis core
  currently assumes one pixel size per grid, so square-pixel regions are the safe
  choice for horizon/analysis work; the CLI prints a note for non-square output.
- `--overwrite` is required when a generated region differs from an existing
  region with the same id, which protects committed grids from accidental change.
- Generated region files are ordinary files under `public/data/terrain/`; commit
  them only if you want that custom region shipped with the application.
- Verified on 2026-11-14 against independent rasterio recomputation (byte-identical,
  maximum absolute difference 0 over every cell):
  - `--extent-km=400x300 --size=1024x768` -> 1024 x 768 px, 390.625 m/px
    (square), bounds [-200,000, -150,000, 200,000, 150,000] m, elevation
    -5,494 to +7,020 m, SHA-256 `70f576a95af31a410f2780f3fa8ca0d589ced11ea34a64bc68f43ae469461b81`.
  - `--extent-km=400x300 --size=1024x768 --center-x=-50000 --center-y=40000`
    -> bounds [-250,000, -110,000, 150,000, 190,000] m, id
    `custom-400x300km-1024x768px-cx-50km-cy40km`, SHA-256
    `ec2e12605a3b872a19ee6c4830284a9a3a15b74771259d39a861728044b8ece2`.
  - `--extent-km=200x350 --size=800x700` -> 800 x 700 px, pixelSizeXM 250 m,
    pixelSizeYM 500 m, SHA-256
    `1d567c15a0c1a4cd8d06de9cd890600c146a13134848ccbacd010fea79913f93`.
  - `--extent=-200000,-300000,200000,300000 --mpp=400` -> 1000 x 1500 px,
    400 m/px (square), SHA-256
    `f761b9022da9e99e55a6533e8dd3cf71499a402d7fbee6203f0b372dd9a57270`.
  Sampled cells agree with source point values within 32 m, which is the expected
  effect of averaging each cell over many source pixels (the exact recomputation
  is the zero-difference proof).

## 5. LROC QuickMap: links only

QuickMap (Arizona State University) is used for human cross-checks and for the site
links in the exported mission brief, not as a data source.

- `https://quickmap.lroc.asu.edu/` responds HTTP 301 and redirects to
  `https://quickmap.lroc.im-ldi.com/` (HTTP 200).
- Deep-link pattern used by the export:
  `https://quickmap.lroc.asu.edu/layers?extent=<minLon>,<minLat>,<maxLon>,<maxLat>&proj=10&secondaryProj=0`
  (verified HTTP 200 after the redirect).
- No API key and no CORS requirement, because the application only links out.

**Attribution:** NASA/GSFC/ASU LROC, LROC QuickMap.

## 6. NASA API keys

The repository convention (`.env.example`, [security.md](security.md)) keeps any
`NASA_API_KEY` in a local `.env` file, never in the repository. **None of the services
used by L-SEA requires a key**: Horizons, Moon Trek and PDS Geosciences are keyless
and open, and `api.nasa.gov` is not called at runtime or at build time.

## 7. CORS test log (2026-11-14)

Every test used `Origin: http://localhost:5173`.

| Request | HTTP | `Access-Control-Allow-Origin` | Consequence |
| --- | --- | --- | --- |
| Horizons `horizons.api` | 200 | absent | pre-compute ephemerides |
| Moon Trek `listVisibleLayers` (polar) | 200 | `*` | live catalogue possible |
| Moon Trek WMTS tile (global south pole) | 200 | `*` | live tiles in the browser |
| Moon Trek WMTS tile (site mosaic) | 200 | `*` | live site mosaics |
| PDS `ldem_80s_80m.jp2` | 200 | absent | pre-compute terrain |
| QuickMap viewer URL | 200 after 301 | n/a | link only |

## 8. Dataset inventory and provenance

| Path | What it is | Size |
| --- | --- | --- |
| `public/data/pois.json` | 10 curated lunar south-pole sites of interest | about 8 KB |
| `public/data/layers.json` | 21 verified Moon Trek WMTS layers | about 39 KB |
| `public/data/ephemeris/` | 10 files x 2,928 topocentric Sun/Earth samples, plus index and schema | about 2.8 MB |
| `public/data/terrain/` | 6 LOLA polar-stereographic int16 grids (2 standard regions + 4 area presets: 100, 200, 300 and 400 km at 1024 px), plus index | about 19 MB |
| `public/data/ai-usage.md` | AI use declaration served by the application | about 7 KB |
| **Total** | | **about 13.4 MB** (copied into `dist/data/`) |

### Ephemerides (JPL Horizons, DE441)

Apparent topocentric azimuth/elevation of the Sun (NAIF 10) and Earth (NAIF 399)
from each site, computed by Horizons with the centre at `coord@301` and airless
conditions. No post-processing of the physical values; the script converts rows to
JSON, rounds angles to 3 decimals and merges the Sun and Earth rows by timestamp.
Range **2026-11-01T00:00:00Z to 2026-12-31T23:30:00Z**, step **30 min**, **2,928
samples** per site with no gaps. The two-month window covers more than two lunar days
(29.5 Earth days each), so day/night, sunrise/sunset and Earth-visibility behaviour
is represented without extrapolation.

Verification performed:

| Check | Result |
| --- | --- |
| Rows per site and body | 2,928, matching the requested range exactly |
| Time continuity | 0 gaps; first and last timestamps match the range |
| Non-finite values | 0 |
| Sun elevation at Shackleton rim (89.78S) | +0.99 to +1.75 degrees; never sets in the window |
| Sun elevation at Nobile rim 2 (83.90S) | -4.64 to +7.65 degrees; rises and sets as expected |
| Earth elevation range | about -7.4 to +10.3 degrees, consistent with lunar libration |
| Azimuth range | full 0-360 degree sweep at all sites |

Limitations: 30-minute sampling with linear interpolation is well below the
terrain-driven horizon uncertainty; local terrain occlusion is deliberately not
included in the ephemeris (the application computes it from the DEM); Earth position
is topocentric apparent, with the light time already included by Horizons.

### Points of interest (curated coordinates)

`public/data/pois.json` is a plain array of 10 sites. `source` is the domain enum
(`poi`); `provenance`, `sourceUrl` and `elevationSource` carry the citations.
Elevations are not hand-written: `scripts/nasa/build-pois.mjs` bilinearly samples them
from the same LOLA grids the application uses, so a site's elevation and the terrain
used for its horizon profile agree.

Longitude is east longitude in 0-360 degrees (IAU, Moon 2000); latitude is negative
south.

| ID | Site | Lat | Lon | Elev. (m) | Coordinate source |
| --- | --- | --- | --- | --- | --- |
| `shackleton-rim` | Shackleton crater rim | -89.78 | 204.27 | 1,734 | Shackleton rim S, highly illuminated point of Mazarico et al. (2011), tabulated by the Orrery Space landing-site catalogue |
| `peak-near-shackleton` | Peak near Shackleton | -89.01701 | 126.27302 | 1,167 | Gracy and Lee (2024), LPSC LV abstract 1695, candidate Artemis III landing site |
| `connecting-ridge` | Connecting Ridge | -89.45 | 222.69 | 1,954 | Connecting Ridge CR1, most-illuminated point of Mazarico et al. (2011), tabulated by Orrery Space |
| `de-gerlache-rim-1` | de Gerlache rim 1 | -88.68 | 292.07 | 1,797 | Centre of the NASA Artemis III site mosaic `Site11_final_adj_5mpp_ColorHillshade`, derived from its WMTS bounding box |
| `de-gerlache-rim-2` | de Gerlache rim 2 | -88.45 | 292.1409 | 1,578 | Wueller et al. (2026) candidate landing site dGR2_K2023, tabulated by Orrery Space |
| `haworth` | Haworth | -86.70 | 336.30 | 1,512 | LROC mosaic centre of the Artemis III Haworth region (Orrery Space) |
| `malapert-massif` | Malapert Massif | -86.00 | 0.30 | 4,810 | LROC mosaic centre of the Artemis III Malapert Massif region (Orrery Space) |
| `leibnitz-beta` | Leibnitz Beta plateau | -85.42 | 31.74 | 6,415 | Centre of the NASA Artemis III site mosaic `Site20_final_adj_5mpp_ClrHillshade_SP`, derived from its WMTS bounding box |
| `nobile-rim-1` | Nobile rim 1 | -85.295 | 36.9168 | 6,747 | Wueller et al. (2026) candidate landing site NR101, tabulated by Orrery Space |
| `nobile-rim-2` | Nobile rim 2 | -83.90 | 58.70 | 943 | LROC mosaic centre of the Artemis III Nobile Rim 2 region (Orrery Space) |

The two derived sites are computed by L-SEA from the official NASA Artemis III site
mosaics served by Moon Trek, using the same spherical polar-stereographic formulas as
the DEM grids. Cross-check against independently published positions: Nobile rim 1
(85.43S, 37.4E derived versus 85.295S, 36.917E published, about 5 km), Nobile rim 2
(83.95S, 58.8E versus 83.90S, 58.70E, about 2 km), Connecting Ridge (89.46S, 222.5E
versus 89.45S, 222.69E, under 1 km), Malapert Massif (86.0S, 359.8E versus 86.0S,
0.3E, about 1 km). The residual difference is the expected offset between a region
centre and a specific published candidate landing site.

Caveats: `de-gerlache-rim-1` and `leibnitz-beta` are region or mosaic centres, not
published landing spots, because no openly licensed exact candidate coordinate was
found in time; this is stated rather than hidden. `perimeterM` (200 m) and `mastM`
(10 m) are mission-profile defaults, not observed quantities. Elevations sampled from
the 594 m/px wide-area grid can differ from higher-resolution studies by a few hundred
metres (for example Malapert Massif is 4,810 m here versus about 4,990 m in some
papers, because this is a 594 m/px sample relative to the reference sphere).

### Terrain (LOLA polar DEMs)

Products, labels, projection and processing are described in section 4. The web grids
are downsampled to 74.06 m/px (default) and 593.75 m/px (wide area); they are
appropriate for kilometre-scale horizon and visibility geometry, not for
landing-hazard assessment. The wide-area grid is used for sites north of 87.5S, so
their horizon angles are coarser than for the inner sites. No shape-from-shading or
NAC photogrammetry DEMs were merged.

### Layers (Moon Trek)

21 WMTS layers, each verified live (capabilities, real tile, image content type, CORS
header). See section 3 for the service details and `public/data/layers.json` for the
per-layer record.

## 9. Licensing and attribution

| Data | Rights | Attribution used |
| --- | --- | --- |
| LRO LOLA DEMs (PDS) | NASA data, public domain and not copyrighted; NASA does not endorse derived products | "NASA/GSFC/LOLA (PDS Geosciences Node)" |
| JPL Horizons ephemerides | NASA/JPL-Caltech; free for use with attribution | "Courtesy NASA/JPL-Caltech (DE441)" |
| Moon Trek tiles and catalogue | NASA/GSFC/ASU service; NASA data | "NASA/GSFC/ASU, Moon Trek (trek.nasa.gov)" |
| LROC QuickMap links | NASA/GSFC/ASU; link only | "NASA/GSFC/ASU LROC QuickMap" |
| IAU names and coordinates | IAU Working Group for Planetary System Nomenclature, public reference data | IAU |
| Orrery Space landing-site catalogue | Third-party compilation of published positions; used for the underlying facts (coordinates) with citation | "coordinates tabulated by the Orrery Space landing-site catalogue", plus the primary paper on each entry |

No NASA logo, flag or mission identifier is used as project branding; the repository
uses text attributions only. Data files are not redistributed beyond the transformed
terrain grids, ephemeris files and layer catalogue needed by this application.

## 10. Pre-compute plan and reproducibility

```bash
# 0. Local DEM: download + verify the products and build the terrain regions
npm run data:lola
#    (or: node scripts/nasa/download-lola.mjs --extent-km=400 --size=1024)

# 1. Ephemerides (Node 24, no dependencies; one request every 1.5 s)
node scripts/nasa/fetch-horizons.mjs --force

# 2. POIs (reads scripts/nasa/sites.mjs and the terrain grids)
node scripts/nasa/build-pois.mjs

# 3. Layer catalogue verification (live requests to Moon Trek)
node scripts/nasa/build-layers.mjs

# 4. Terrain (Python 3 with rasterio; downloads the PDS JP2 products)
python3 scripts/nasa/build-terrain.py --jpeg2000-dir /tmp/lola --out-dir public/data/terrain
```

Source products are cached under `.cache/lola/` (gitignored); the repository contains
only the derived, browser-ready files. `build-terrain.py` remains the reproducible
builder for the two committed grids, while `download-lola.mjs` is the user-facing
local download and custom-region step. Rebuild the ephemerides
only when the mission window changes, the layer catalogue when it is edited or a layer
disappears, and terrain only if the grid geometry changes. `npm run build` copies
`public/data/` into `dist/data/`.

## 11. Dead ends and alternatives investigated

| Attempt | Result | What was used instead |
| --- | --- | --- |
| Moon Trek WMS GetCapabilities (`/moontrek/wms?...`) | HTTP 404; Moon Trek does not expose WMS | WMTS REST tiles (verified) |
| `PSR_SP` layer label | HTTP 404 | `LRO_LOLA_Illumination_SPole65S_240m` (verified PSR raster) |
| `A3_Named_regions_SP` as a tile layer | capabilities 404; it is a catalogue item, not WMTS | not shipped; the application ships its own POIs |
| QuickMap data API (`quickmap.lroc.asu.edu/api/...`) | host redirects to a single-page application without a documented open API | link-only use (verified deep links) |
| Zenodo south-pole shape-from-shading dataset | HTTP 403 in this environment | not used |
| LOLA `.img` (uncompressed, 115.5 MB) as terrain input | valid data but 4-5 times larger than the JP2 equivalent | PDS JP2 products (same data, smaller) |
| Published coordinates for the de Gerlache rim 1 and Leibnitz Beta region centres | not found in openly accessible sources during the event | derived from the official NASA Artemis III site-mosaic WMTS footprints and labelled as derived |

## 12. Failure modes and fallbacks

| Failure | Effect | Fallback |
| --- | --- | --- |
| Horizons unreachable at build time | ephemerides cannot be refreshed | committed ephemeris files already cover the whole mission window; no runtime dependency |
| Moon Trek tile server down | 3D map layer unavailable | the application renders the DEM terrain mesh from `public/data/terrain/`; the layer panel reports the degraded state |
| WMS request instead of WMTS | 404; Moon Trek exposes WMTS only | use the RESTful WMTS template documented in section 3 |
| Static hosting blocks third-party images | tiles blocked | the layer catalogue records `viewerUrl` for opening Moon Trek directly |
| Network offline during a demo | live layers fail | sites, ephemerides and terrain are local; the application has a no-WebGL 2D fallback |

## 13. Official-source verification

Every value shipped in `public/data/` comes from an official NASA source. The
command below re-checks the sources and the shipped artefacts against their
provenance metadata:

```bash
node scripts/nasa/verify-sources.mjs
```

Last run (2026-11-14): **all 12 checks passed**.

| Check | Result |
| --- | --- |
| `south-pole-875s-20m` metadata matches PDS `ldem_875s_20m.jp2` (7584 x 7584, R = 1,737,400 m) | PASS |
| `south-pole-80s-80m` metadata matches PDS `ldem_80s_80m.jp2` (7600 x 7600, R = 1,737,400 m) | PASS |
| Terrain index references both LOLA regions | PASS |
| PDS `ldem_875s_20m.jp2` downloadable, 21,462,406 bytes | PASS |
| PDS `ldem_80s_80m.jp2` downloadable, 29,837,992 bytes | PASS |
| PDS label declares data set `LRO-L-LOLA-4-GDR-V1.0`, scaling 0.5, offset 1,737,400 | PASS |
| JPL Horizons API reachable (`ssd.jpl.nasa.gov`) | PASS |
| NASA Moon Trek south-pole layer catalogue reachable (`trek.nasa.gov`) | PASS |
| LROC QuickMap reachable (`quickmap.lroc.asu.edu`) | PASS |
| No non-NASA ephemeris library in the dependencies | PASS |
| No forbidden ephemeris library imported anywhere in `src/` or `scripts/` | PASS |
| `index.html` loads no external scripts or styles | PASS |

The four data sources used by the project are all NASA or NASA-partner official
resources:

| Data | Official provider |
| --- | --- |
| Sun/Earth ephemerides | NASA/JPL Horizons (DE441) |
| Lunar terrain | NASA LRO LOLA, PDS Geosciences Node |
| Map layers | NASA Moon Trek (NASA/GSFC) |
| Site cross-checks and links | NASA LROC QuickMap (NASA/GSFC/ASU) |

No third-party ephemeris library (Skyfield, astropy, pyephem) is used anywhere
in the project. The ephemerides are retrieved directly from the JPL Horizons API
by `scripts/nasa/fetch-horizons.mjs` and committed as pre-computed datasets.

Runtime check (live deployment, 2026-11-14): a headless-browser network capture
of <https://l-sea-space-apps.vercel.app> showed only same-origin requests
(application assets and `/data/{terrain,ephemeris,layers,pois}`); the terrain
grid fetched by the viewer is `/data/terrain/south-pole-80s-80m.bin` and the
ephemeris file is `/data/ephemeris/<site>.json`. No external astronomy service
and no third-party positional library is called by the browser: the interface
receives Sun/Earth azimuth/elevation values already computed from the committed
JPL Horizons datasets and only renders them.

### LOLA download record

| Product | URL | Size | SHA-256 of the downloaded file |
| --- | --- | --- | --- |
| LDEM_875S_20M | `.../polar/jp2/ldem_875s_20m.jp2` | 21,462,406 bytes | `fff7c2017a192788066a0867d78fd1ccf783216e26974b5e65287669aa472bac` |
| LDEM_80S_80M | `.../polar/jp2/ldem_80s_80m.jp2` | 29,837,992 bytes | `c088dd4f510e879375ee7e6f0d320ba84115f535f45fb592dd7f83a7d2e83ae3` |

Base directory:
`https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2/`

The files are resampled locally by `scripts/nasa/build-terrain.py` (Python 3 +
rasterio) into the browser-ready int16 grids described in section 4. The source
files are cached outside the repository.
