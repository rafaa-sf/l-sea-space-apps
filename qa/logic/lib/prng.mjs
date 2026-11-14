/**
 * Deterministic PRNG utilities for the L-SEA Monte Carlo logic harness.
 *
 * `mulberry32` is the seeded generator required by SPEC §2. Each trial has a
 * *case seed* derived from the run seed and the case index, so a single case can
 * be reproduced without replaying all previous cases:
 *
 *   node logic-mc.mjs --seed 20261114 --case 4242
 *
 * @module logic/lib/prng
 */

/**
 * mulberry32: fast 32-bit seeded PRNG returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Derive a stable 32-bit case seed from the run seed and case index.
 * Uses a splitmix32-style avalanche so adjacent indices are uncorrelated.
 * @param {number} seed Run seed.
 * @param {number} index Case index (>= 0).
 * @returns {number}
 */
export function caseSeedFor(seed, index) {
  let z = (seed ^ Math.imul((index + 1) >>> 0, 0x9e3779b9)) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
  return (z ^ (z >>> 16)) >>> 0
}

/** Small deterministic string → 32-bit hash (used for tags/ids). */
export function hashString(value) {
  let h = 2166136261
  const text = String(value)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Couple a PRNG next() with common helpers used by the scenario generator.
 * @param {number} seed
 */
export function makeRng(seed) {
  const next = mulberry32(seed)
  const rng = {
    next,
    float: next,
    /** Uniform float in [min, max). */
    range(min, max) {
      return min + (max - min) * next()
    },
    /** Uniform integer in [min, max] (inclusive). */
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next())
    },
    /** Random element of an array. */
    pick(array) {
      return array[Math.floor(next() * array.length)]
    },
    /** True with probability p. */
    chance(p) {
      return next() < p
    },
    /** Random element with a weight function. */
    weightedPick(items, weightOf) {
      const weights = items.map((item) => Math.max(0, weightOf(item)))
      const total = weights.reduce((sum, value) => sum + value, 0)
      if (total <= 0) return items[0]
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },
  }
  return rng
}
