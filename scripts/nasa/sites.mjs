// L-SEA Space Apps - curated lunar south-pole sites of interest (POIs).
//
// Coordinates are selenographic (IAU Moon 2000) latitude in degrees (-90..90,
// negative south) and east longitude in degrees (0..360). Sources are recorded
// per site so that the provenance of every coordinate is auditable; see
// docs/data-sources.md for the full discussion.
//
// Elevations are NOT stored here: scripts/nasa/build-pois.mjs samples them from
// the real LOLA DEM subsets in public/data/terrain/ so that the point elevation
// and the terrain grid used for horizon/visibility computations agree.

export const MOON_RADIUS_M = 1737400

/**
 * @typedef {object} Site
 * @property {string} id          stable slug, also the ephemeris file name
 * @property {string} name        English display name
 * @property {number} lat         degrees, negative south
 * @property {number} lon         degrees east, 0..360
 * @property {string} provenance  short provenance of the coordinate
 * @property {string} sourceUrl   primary URL backing the coordinate
 * @property {string} note        one-line description for tooltips/docs
 */

/** @type {Site[]} */
export const SITES = [
  {
    id: 'shackleton-rim',
    name: 'Shackleton crater rim',
    lat: -89.78,
    lon: 204.27, // 155.73 deg W
    provenance:
      'Shackleton rim S, highly illuminated point of Mazarico et al. (2011), ' +
      'coordinates tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/shackleton-rim-s/',
    note:
      'Highest-illumination point on the Shackleton crater rim; classic ' +
      'candidate for a solar-powered polar outpost.',
  },
  {
    id: 'peak-near-shackleton',
    name: 'Peak near Shackleton',
    lat: -89.01701,
    lon: 126.27302,
    provenance:
      'Gracy & Lee (2024), LPSC LV abstract 1695: candidate Artemis III ' +
      'landing site inside the "Peak Near Shackleton" candidate region',
    sourceUrl: 'https://www.hou.usra.edu/meetings/lpsc2024/pdf/1695.pdf',
    note:
      'Candidate landing site near the rim of a crater hosting an H2O-ice ' +
      'bearing permanently shadowed region (PSR #112).',
  },
  {
    id: 'connecting-ridge',
    name: 'Connecting Ridge',
    lat: -89.45,
    lon: 222.69, // 137.31 deg W
    provenance:
      'Connecting Ridge CR1, most-illuminated point of the Shackleton-de ' +
      'Gerlache ridge in Mazarico et al. (2011), coordinates tabulated by ' +
      'the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/connecting-ridge-cr1/',
    note:
      'Saddle between Shackleton and de Gerlache craters; long-duration ' +
      'sunlight and direct-to-Earth visibility on the ridge crest.',
  },
  {
    id: 'de-gerlache-rim-1',
    name: 'de Gerlache rim 1',
    lat: -88.68,
    lon: 292.07,
    provenance:
      'Centre of the NASA Artemis III "de Gerlache Rim" site mosaic ' +
      '(Moon Trek layer Site11_final_adj_5mpp_ColorHillshade), derived from ' +
      'the WMTS bounding box in polar stereographic metres',
    sourceUrl:
      'https://trek.nasa.gov/tiles/Moon/SP/Site11_final_adj_5mpp_ColorHillshade/1.0.0/WMTSCapabilities.xml',
    note:
      'Inner rim of de Gerlache crater, on the Shackleton-de Gerlache ridge ' +
      'that connects two of the highest-insolation areas near the pole.',
  },
  {
    id: 'de-gerlache-rim-2',
    name: 'de Gerlache rim 2',
    lat: -88.45,
    lon: 292.1409, // 67.8591 deg W
    provenance:
      'Wueller et al. (2026) candidate landing site dGR2_K2023, coordinates ' +
      'tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/de-gerlache-rim-2/',
    note:
      'Outer de Gerlache rim candidate, 47 km from the pole; long sunlit ' +
      'periods and PSR access.',
  },
  {
    id: 'haworth',
    name: 'Haworth',
    lat: -86.7,
    lon: 336.3, // 23.7 deg W
    provenance:
      'LROC mosaic centre for the NASA Artemis III "Haworth" candidate ' +
      'region, tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/haworth/',
    note:
      'Candidate region on the Haworth crater rim, 100 km from the pole; ' +
      'access to shadowed volatile deposits.',
  },
  {
    id: 'malapert-massif',
    name: 'Malapert Massif',
    lat: -86.0,
    lon: 0.3,
    provenance:
      'LROC mosaic centre for the NASA Artemis III "Malapert Massif" ' +
      'candidate region, tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/malapert-massif/',
    note:
      'High massif at 86S, 121 km from the pole; long illumination periods ' +
      'and direct line of sight to Earth.',
  },
  {
    id: 'leibnitz-beta',
    name: 'Leibnitz Beta plateau',
    lat: -85.42,
    lon: 31.74,
    provenance:
      'Centre of the NASA Artemis III "Leibnitz Beta Plateau" site mosaic ' +
      '(Moon Trek layer Site20_final_adj_5mpp_ClrHillshade_SP), derived from ' +
      'the WMTS bounding box in polar stereographic metres',
    sourceUrl:
      'https://trek.nasa.gov/tiles/Moon/SP/Site20_final_adj_5mpp_ClrHillshade_SP/1.0.0/WMTSCapabilities.xml',
    note:
      'Elevated plateau 139 km from the pole, candidate region with wide ' +
      'sunlit terrain.',
  },
  {
    id: 'nobile-rim-1',
    name: 'Nobile rim 1',
    lat: -85.295,
    lon: 36.9168,
    provenance:
      'Wueller et al. (2026) candidate landing site NR101, coordinates ' +
      'tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/nobile-rim-1/',
    note:
      'Candidate landing site on the northern rim of Nobile crater, 143 km ' +
      'from the pole.',
  },
  {
    id: 'nobile-rim-2',
    name: 'Nobile rim 2',
    lat: -83.9,
    lon: 58.7,
    provenance:
      'LROC mosaic centre for the NASA Artemis III "Nobile Rim 2" candidate ' +
      'region, tabulated by the Orrery Space landing-site catalogue',
    sourceUrl: 'https://orreryspace.com/landing-sites/nobile-rim-2/',
    note:
      'Candidate landing region 185 km from the pole, one of the outermost ' +
      'Artemis III regions and the best ranked by recent multi-criteria studies.',
  },
]

/** Default mission geometry used when none is supplied by the mission profile. */
export const DEFAULT_SITE_GEOMETRY = { perimeterM: 200, mastM: 10 }

/** Time range and cadence of the pre-computed Horizons ephemerides (UTC). */
export const EPHEMERIS_RANGE = {
  start: '2026-11-01T00:00:00Z',
  end: '2026-12-31T23:30:00Z',
  stepMinutes: 30,
}
