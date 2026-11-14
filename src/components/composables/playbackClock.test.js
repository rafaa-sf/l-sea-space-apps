import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackClock } from './playbackClock.js'

afterEach(() => {
  vi.useRealTimers()
})

function makeClock(intervalMs = 100) {
  let ticks = 0
  const clock = createPlaybackClock({ onTick: () => { ticks += 1 }, intervalMs })
  return { clock, ticks: () => ticks }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('playback clock (issue #11)', () => {
  it('ticks only while running', () => {
    vi.useFakeTimers()
    const { clock, ticks } = makeClock()
    vi.advanceTimersByTime(500)
    expect(ticks()).toBe(0)
    clock.start()
    vi.advanceTimersByTime(500)
    expect(ticks()).toBe(5)
    clock.stop()
    vi.advanceTimersByTime(2000)
    expect(ticks()).toBe(5)
  })

  it('start is idempotent: two starts still run one interval', () => {
    vi.useFakeTimers()
    const { clock, ticks } = makeClock()
    expect(clock.start()).toBe(true)
    expect(clock.start()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(ticks()).toBe(10) // not 20
  })

  it('stop clears the timer and is idempotent', () => {
    vi.useFakeTimers()
    const { clock } = makeClock()
    clock.start()
    expect(clock.stop()).toBe(true)
    expect(clock.stop()).toBe(false)
    expect(clock.isRunning()).toBe(false)
  })

  it('toggle stops and restarts a single timer', () => {
    vi.useFakeTimers()
    const { clock, ticks } = makeClock()
    clock.toggle()
    expect(clock.isRunning()).toBe(true)
    clock.toggle()
    expect(clock.isRunning()).toBe(false)
    const before = ticks()
    vi.advanceTimersByTime(1000)
    expect(ticks()).toBe(before)
  })

  it('random operation sequences never leak or duplicate the interval', () => {
    vi.useFakeTimers()
    const rand = mulberry32(20261114)
    for (let sequence = 0; sequence < 200; sequence += 1) {
      const { clock, ticks } = makeClock(100)
      for (let step = 0; step < 12; step += 1) {
        const op = Math.floor(rand() * 4)
        if (op === 0) clock.start()
        else if (op === 1) clock.stop()
        else if (op === 2) clock.toggle()
        else vi.advanceTimersByTime(Math.floor(rand() * 400))

        const before = ticks()
        vi.advanceTimersByTime(500)
        const after = ticks()
        if (clock.isRunning()) {
          expect(after).toBeGreaterThan(before)
          // exactly one interval of 100 ms in 500 ms, never double
          expect(after - before).toBe(5)
        } else {
          expect(after).toBe(before)
        }
      }
    }
  }, 30000)

  it('the onTick error does not kill the clock', () => {
    vi.useFakeTimers()
    let calls = 0
    const clock = createPlaybackClock({ onTick: () => { calls += 1; throw new Error('boom') }, intervalMs: 100 })
    clock.start()
    vi.advanceTimersByTime(300)
    expect(calls).toBe(3)
    expect(clock.isRunning()).toBe(true)
    clock.stop()
  })
})
