# Playback state-machine simulator

Stress-tests the mission-time playback transport (`Play` / `Pause` / `Now` /
±1 h / date-time changes / jump to sunset-earthset / mission updates) against
the **real store** (`src/components/composables/useAppState.js`) under fake
timers.

It runs thousands of random operation sequences and checks, after every step:

| Invariant | Meaning |
| --- | --- |
| `I1` | when `playing === false`, the mission clock must not advance |
| `I2` | when `playing === true`, exactly **one** playback interval is active |
| `I3` | when `playing === false`, **no** playback interval may be active (no leak) |
| `I4` | two consecutive `startPlayback()` calls keep one interval |
| `I5` | `togglePlayback()` twice returns to stopped with no interval |
| `I6` | `setNow()` stops playback and clears the interval |

It also runs deterministic checks, targeted “play a lot with time changes then
pause” templates, and reports a **minimised reproducer** for the first failing
sequence.

## Usage

```bash
node qa/playback/playback-sim.mjs --sequences 20000 --seed 20261114 --max-steps 30
```

- `--sequences` number of random sequences (default 5000)
- `--seed` deterministic PRNG seed (default 20261114)
- `--max-steps` maximum operations per sequence (default 30)

Exit code `0` means every sequence and every deterministic check passed; `1`
means failures (details in `qa/playback/results/*.json`).

## Background

Written while triaging issue #11 (`Now` left an orphaned `setInterval` running,
so `Pause` only cancelled the last timer). The simulator reproduced the leak on
20 000 sequences (38.2 % failing, all triggered by `Now`) and now guards the
fixed single-interval clock.
