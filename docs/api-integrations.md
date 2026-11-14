# API integrations

Exact endpoints, verified example queries, CORS behaviour, rate limits,
attribution and pre-compute plan for every NASA service used by L-SEA.

> **Verification status:** every URL and query in this document was executed
> against the live service on **2026-11-14** (Málaga event weekend) with the
> scripts in `scripts/nasa/`. The responses quoted are real. Where a service
> could not be used as hoped, that is stated explicitly instead of being
> glossed over.

## Runtime model: static deployment, pre-computed NASA data

The application is a **static Vite build** deployed to Vercel hosting. There is
no server-side runtime, so only services that send CORS headers can be called
directly from the browser. That splits the data into two classes:

| Class | Service | CORS | Runtime use |
| --- | --- | --- | --- |
| Map imagery (WMTS tiles) | NASA Moon Trek | `Access-Control-Allow-Origin: *` | called live by the browser |
| Ephemeris (Sun/Earth positions) | JPL Horizons | **no CORS header** | **must be pre-computed** into `public/data/ephemeris/` |
| Terrain (DEM) | PDS Geosciences LOLA | no CORS header | pre-computed into `public/data/terrain/` |
| Nomenclature / coordinates | IAU WGCCRE, published papers | n/a | curated into `public/data/pois.json` |

The Vite dev server proxies `/nasa/horizons` to `https://ssd.jpl.nasa.gov` so a
developer can experiment with live queries during development (`vite.config.js`);
production never uses it.

---

## 1. JPL Horizons API (ephemerides) — pre-computed

### Endpoint

```text
https://ssd.jpl.nasa.gov/api/horizons.api
```

JPL Horizons is the authoritative ephemeris service for solar-system bodies.
L-SEA requests the **apparent topocentric azimuth and elevation of the Sun and
the Earth from an observer standing on the Moon**, using the DE441 ephemeris.

### Verified query parameters

| Parameter | Value used by L-SEA | Meaning |
| --- | --- | --- |
| `format` | `text` | text response with `$$SOE`/`$$EOE` data block |
| `COMMAND` | `'10'` (Sun) or `'399'` (Earth) | target body NAIF ID |
| `OBJ_DATA` | `NO` | do not emit the object data block |
| `MAKE_EPHEM` | `YES` | generate an ephemeris |
| `EPHEM_TYPE` | `OBSERVER` | observer table (az/el) instead of vectors |
| `CENTER` | `'coord@301'` | observer at a user site on the **Moon** (NAIF 301) |
| `COORD_TYPE` | `'GEODETIC'` | interpret `SITE_COORD` as lon/lat/altitude |
| `SITE_COORD` | `'<lon>,<lat>,0'` | east-longitude deg, latitude deg, altitude km |
| `QUANTITIES` | `'4'` | apparent azimuth and elevation |
| `ANG_FORMAT` | `'DEG'` | decimal degrees |
| `CSV_FORMAT` | `'YES'` | comma-separated rows, easy to parse |
| `STEP_SIZE` | `'30m'` | 30-minute cadence |
| `TIME_ZONE` | `'0'` | UTC output |
| `START_TIME` | `'2026-Nov-01 00:00'` | UTC |
| `STOP_TIME` | `'2026-Dec-31 23:30'` | UTC |

`SITE_COORD` order is **east longitude, latitude, altitude in km** — the same
order Horizons documents for `GEODETIC`. The lunar reference sphere used by
Horizons is `R = 1737.4 km`, matching `MOON_RADIUS_M = 1737400` in the app.

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

Response (abridged; full run is 153 kB):

```text
API VERSION: 1.2
...
Target body name: Sun (10)                        {source: DE441}
Center body name: Moon (301)                      {source: DE441}
Center geodetic : 336.3, -86.7, 0.0               {E-lon(deg),Lat(deg),Alt(km)}
Atmos refraction: NO (AIRLESS)
Table format    : Comma Separated Values (spreadsheet)
 Date__(UT)__HR:MN, , ,Azi_(a-app), Elev_(a-app),
*************************************************
$$SOE
 2026-Nov-01 00:00,*,i, 308.718817,     3.523563,
 2026-Nov-01 00:30,*,i, 308.465174,     3.512356,
...
 2026-Dec-31 23:30,*, , 286.986528,     1.980858,
$$EOE
```

Fields after the timestamp: solar-presence marker, interferer marker, azimuth
(deg), elevation (deg). The parser reads fields 3 and 4 (0-based).

### CORS status — **no CORS header** (verified)

```text
$ curl -sS -D - -o /dev/null -H "Origin: http://localhost:5173" \
    "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&..."
HTTP/1.1 200 OK
Server: nginx
Date: ...
Content-Type: text/plain
Transfer-Encoding: chunked
```

There is **no `Access-Control-Allow-Origin`** header, therefore the static
production app cannot call Horizons from the browser. This is why the
`public/data/ephemeris/*.json` files exist. The dev proxy in `vite.config.js`
(`/nasa/horizons` → `https://ssd.jpl.nasa.gov/api/horizons.api`) is for
development only.

### Rate limits and etiquette

- JPL asks users to be considerate; there is no API key and no published hard
  quota. L-SEA sends **one request at a time with a 1.5 s delay** (~0.6 req/s),
  identifies itself in `User-Agent`, and retries HTTP 429/5xx with exponential
  backoff (2 s, 4 s, 8 s, max 4 attempts). A full refresh is 20 requests.
- Results are cached in `public/data/ephemeris/` and only re-fetched with
  `--force`.

### Pre-computed artefacts

- Script: [`scripts/nasa/fetch-horizons.mjs`](../scripts/nasa/fetch-horizons.mjs)
- Files: `public/data/ephemeris/<site-id>.json` + `index.json` + `README.md`
- 10 sites x 2 bodies x 2 928 samples (30-minute steps) = 58 560 samples.
- Shape and semantics: [`public/data/ephemeris/README.md`](../public/data/ephemeris/README.md).

Attribution: **NASA/JPL-Caltech** (`Courtesy NASA/JPL-Caltech`, ephemeris DE441).

---

## 2. NASA Moon Trek (WMTS map layers) — used live

Moon Trek is NASA/JPL's lunar mapping portal. L-SEA uses its public OGC WMTS
services for south-polar layers (LOLA shaded relief, LROC mosaics, slope,
illumination, Earth visibility, PSR, Diviner temperature and the official
Artemis III site mosaics).

### Service endpoints (all verified)

| Purpose | URL |
| --- | --- |
| Service catalogue (south-polar projection) | `https://trek.nasa.gov/moon/TrekServices/ws/index/polar/listVisibleLayers?proj=urn:ogc:def:crs:IAU2000::30120&start=0&rows=2147483647` |
| Search API (all products) | `https://trek.nasa.gov/moon/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647` |
| WMTS endpoint for one layer | `https://trek.nasa.gov/moon/TrekServices/ws/index/getLayerServices?uuid=<item_UUID>` |
| WMTS capabilities | `https://trek.nasa.gov/tiles/Moon/SP/<layerLabel>/1.0.0/WMTSCapabilities.xml` |
| Tile template (RESTful) | `https://trek.nasa.gov/tiles/Moon/SP/<layerLabel>/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png` |
| Layer catalogue config | `https://trek.nasa.gov/tiles/apidoc/config/config.json` |
| API documentation | `https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon` |

The catalogue query returns **347 south-polar layers** as JSON (productLabel,
title, description, resolution, `item_UUID`, thumbnail URL). Example response:

```json
{
  "productLabel": "A3_Named_regions_SP",
  "title": "Artemis III Candidate Landing Regions, S Pole",
  "resolution": 0.0,
  "item_UUID": "2a261565-52ca-42e2-ab67-01427512dbea"
}
```

`getLayerServices?uuid=<item_UUID>` returns the WMTS `endPoint` for a product,
e.g. `https://trek.nasa.gov/tiles/Moon/SP/Site04_final_adj_5mpp_ColorHillshade`
for `item_UUID=130e09bd-da8c-465c-a424-09999f76fbe6`.

### Projection and tile scheme

- Projection: **IAU2000:30120**, lunar south polar stereographic
  (latitude of origin -90, central meridian 0, `R = 1737400 m`).
- Tile matrix set `default028mm`; matrix sizes start at **2 x 1 tiles at zoom 0**
  and double per level. Zoom range depends on the product (e.g. the 5 m/px LOLA
  layer offers zoom 0-9; site mosaics 0-10; see `maxZoom` in `layers.json`).
- The tiles are *projected*, not equirectangular lat/lon: the app documents this
  and keeps the layer catalogue separate from the DEM lat/lon grid.

### CORS status — **enabled** (verified)

```text
$ curl -sS -D - -o /dev/null -H "Origin: http://localhost:5173" \
    "https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/1.0.0/default/default028mm/0/0/0.png"

HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Content-Type: image/png
```

The catalogue service also returns `Access-Control-Allow-Origin: *` (verified on
`listVisibleLayers`). The static app therefore requests tiles directly; it has a
Two.js/2D fallback when WebGL — or the tile server — is unavailable.

### Verified layer catalogue

[`scripts/nasa/build-layers.mjs`](../scripts/nasa/build-layers.mjs) re-verifies
the whole catalogue on demand: it fetches each layer's capabilities, reads the
`ResourceURL` template and tile-matrix zoom range, and requests a real tile with
an `Origin` header before writing `public/data/layers.json`. Current result:

| Item | Result |
| --- | --- |
| Layers defined | 21 |
| Verified (capabilities + real tile + image content-type) | **21 / 21** |
| CORS header present on every tile probe | **yes (`*`)** |
| Layers with data at zoom 0 | all |
| Known unavailable label tried | `PSR_SP` → HTTP 404 (the PSR raster is served as `LRO_LOLA_Illumination_SPole65S_240m`, which is verified and included) |
| Artemis III named-region outline | `A3_Named_regions_SP` exists as a cargo item but is **not** a WMTS layer (capabilities 404) so it is not in `layers.json` |

Catalogue detail: `public/data/layers.json` (id, name, description, kind, label,
`url` with `{z}/{y}/{x}` placeholders, verbatim `template`, format, min/max zoom,
projection, bounds, attribution, viewer URL, and the per-layer verification
record: status, CORS header, content type, byte size, probe URL and time).

Attribution: **NASA/GSFC/ASU — Moon Trek (trek.nasa.gov)**, LRO/LOLA/LROC teams.
Moon Trek terms: <https://trek.nasa.gov/>. Deep links used in the export brief:

```text
https://trek.nasa.gov/moon/#/v1/115/0.5/0/<lon>/<lat>/-170.000/0.000/90.000/0/0/0
```

(verified HTTP 200).

---

## 3. PDS Geosciences Node — LOLA polar DEMs (terrain) — pre-computed

### Endpoint and products

Base directory:

```text
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/
```

| Product | File | Size | Grid | Coverage |
| --- | --- | --- | --- | --- |
| LDEM_875S_20M | `jp2/ldem_875s_20m.jp2` | 21,462,406 B (21.5 MB) | 7584 x 7584, int16 | 87.5S-90S, 20 m/px |
| LDEM_80S_80M | `jp2/ldem_80s_80m.jp2` | 29,837,992 B (29.8 MB) | 7600 x 7600, int16 | 80S-90S, 80 m/px |

The same products exist as `.img` (raw, uncompressed) with PDS labels in
`polar/img/`, e.g. `ldem_80s_80m.lbl` documents:

```text
DATA_SET_ID            = "LRO-L-LOLA-4-GDR-V1.0"
OBJECT                 = IMAGE
  LINES                = 7600
  LINE_SAMPLES         = 7600
  SAMPLE_TYPE          = LSB_INTEGER
  SAMPLE_BITS          = 16
  UNIT                 = METER
  SCALING_FACTOR       = 0.5
  OFFSET               = 1737400.
```

`HEIGHT = DN * SCALING_FACTOR` gives metres relative to the `1737400 m`
reference radius; `PLANETARY_RADIUS = DN * SCALING_FACTOR + OFFSET`.

Projection block of the same label:

```text
MAP_PROJECTION_TYPE   = "POLAR STEREOGRAPHIC"
KEYWORD_LATITUDE_TYPE = "PLANETOCENTRIC"
CENTER_LATITUDE       = -90 <deg>
CENTER_LONGITUDE      = 0 <deg>
MAP_SCALE             = 80 <m/pix>
LINE_PROJECTION_OFFSET  = 3799.5 <pix>
SAMPLE_PROJECTION_OFFSET = 3799.5 <pix>
```

Forward/inverse spherical polar-stereographic formulas used throughout the app:

```text
rho = 2 * R * tan(pi/4 + lat/2)
x   = rho * sin(lon)      lon = atan2(x, y)
y   = rho * cos(lon)      lat = 2 * atan(rho / (2*R)) - pi/2
```

### CORS status — no CORS header (verified); irrelevant, pre-computed

The PDS file server returns the file with typical IIS headers (`accept-ranges`,
`etag`) and **no `Access-Control-Allow-Origin`**. The app never fetches these
files at runtime; the build script resamples them into web grids.

### Pre-computed artefacts

- Script: [`scripts/nasa/build-terrain.py`](../scripts/nasa/build-terrain.py)
  (Python 3 + `rasterio`; run once locally, not part of the web build).
- Output: `public/data/terrain/`
  - `south-pole-875s-20m.json` + `.bin` — 2048 x 2048, 74.06 m/px, int16 metres,
    bounds ±75 840 m; ~8.4 MB bin.
  - `south-pole-80s-80m.json` + `.bin` — 1024 x 1024, 593.75 m/px, int16 metres,
    bounds ±304 000 m; ~2.1 MB bin.
  - `index.json` — region list, projection description and default region.
- Format: little-endian int16, row-major, row 0 = max Y (north edge), values in
  metres relative to `R = 1737400 m`. No-data pixels are `-32768`.

Attribution: **NASA/GSFC/LOLA (PDS Geosciences Node)**. Data set
`LRO-L-LOLA-4-GDR-V1.0`, producer LOLA team / NASA Goddard Space Flight Center.

---

## 4. LROC QuickMap — links only

QuickMap (Arizona State University) is used for **human cross-checks and for the
site links in the exported mission brief**, not as a data source.

- `https://quickmap.lroc.asu.edu/` responds HTTP 301 and redirects to
  `https://quickmap.lroc.im-ldi.com/` (verified, HTTP 200).
- Deep link pattern used by the app's export:
  `https://quickmap.lroc.asu.edu/layers?extent=<minLon>,<minLat>,<maxLon>,<maxLat>&proj=10&secondaryProj=0`
  (verified HTTP 200 after redirect).
- No API key and no CORS requirement because the app only links out to it.

Attribution: **NASA/GSFC/ASU LROC — LROC QuickMap**.

---

## 5. NASA API key (`api.nasa.gov`)

The repository convention (`.env.example`, `docs/security.md`) is to keep any
`NASA_API_KEY` in a local `.env` file, never in the repository. **None of the
services used by L-SEA requires a key**: Horizons, Moon Trek and PDS Geosciences
are keyless and open, and `api.nasa.gov` is not called at runtime or at build
time. The variable is reserved for future NASA APIs (e.g. APOD, EPIC) if the
team adds imagery sections.

---

## 6. CORS test log (2026-11-14)

Every test below was a real request with `Origin: http://localhost:5173`:

| Request | HTTP | `Access-Control-Allow-Origin` | Consequence |
| --- | --- | --- | --- |
| `SSD/JPL Horizons` `horizons.api` | 200 | **absent** | pre-compute ephemerides |
| Moon Trek `listVisibleLayers` (polar) | 200 | `*` | live catalogue is possible |
| Moon Trek WMTS tile (5 m LOLA, global SP) | 200 | `*` | live tiles in the browser |
| Moon Trek WMTS tile (site mosaic) | 200 | `*` | live site mosaics |
| PDS `ldem_80s_80m.jp2` | 200 | **absent** | pre-compute terrain |
| QuickMap viewer URL | 200 (after 301) | n/a | link only |

---

## 7. Failure modes and fallbacks

| Failure | Effect | Fallback |
| --- | --- | --- |
| Horizons unreachable at build time | ephemerides cannot be refreshed | committed `public/data/ephemeris/*.json` already contain the whole mission window; no runtime dependency |
| Moon Trek tile server down | 3D map layer unavailable | app renders the DEM terrain mesh from `public/data/terrain/`; layer panel reports the degraded state |
| WMS request (instead of WMTS) | 404 — Moon Trek exposes WMTS only | use the RESTful WMTS template documented above |
| Static hosting blocks third-party images (CSP) | tiles blocked | the layer catalogue records `viewerUrl` so the user can open Moon Trek directly |
| Network offline during a demo | live layers fail | everything critical (sites, ephemeris, terrain) is local; the app has a no-WebGL 2D fallback |

---

## 8. Refresh plan

1. Mission window is **2026-11-01 → 2026-12-31** (Artemis-era mission date
   chosen for the demo). To change it, edit `EPHEMERIS_RANGE` in
   `scripts/nasa/sites.mjs`, run `node scripts/nasa/fetch-horizons.mjs --force`,
   then `npm run build`.
2. The Moon Trek catalogue is static; re-run `node scripts/nasa/build-layers.mjs`
   if a layer 404s or to extend the catalogue.
3. Terrain is a one-off; re-run `python3 scripts/nasa/build-terrain.py` only if
   the app grid changes. Downloaded source products are cached outside the
   repository and never committed.
