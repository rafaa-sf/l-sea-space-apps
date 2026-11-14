/**
 * Barrel export of the L-SEA scientific core.
 *
 * The UI can import individual modules (`../core/engine.js`) or the whole core
 * through this file; both are framework-agnostic (no Vue imports).
 *
 * @module core
 */

export * from './geometry.js'
export * from './terrain.js'
export * from './engine.js'
export * from './ephemeris.js'
export * from './power.js'
export * from './comms.js'
export * from './autopilot.js'
export * from './zones.js'
export * from './zoneAutopilot.js'
export * from './landingMetrics.js'
