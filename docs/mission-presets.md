# Historical mission profile presets

The site comparator includes a **mission profile preset** dropdown with
approximate historical lunar missions. Selecting a preset applies its
mission-level constraints (surface stay, power source, battery, relay, data
budget, mast) to the whole application, so the same south-pole sites can be
compared under different eras of lunar exploration.

These profiles are **approximations for comparison**, not flight data. They map
documented mission characteristics onto the L-SEA mission model:

| Preset | Year | Surface stay | Power | Relay | Notes |
| --- | --- | --- | --- | --- | --- |
| Apollo 11 | 1969 | 1 day | On-board fuel cells (modelled as non-solar/RTG-equivalent) | No | Short crewed sortie, small data budget |
| Apollo 17 | 1972 | 3 days | On-board fuel cells (non-solar) | No | Longest Apollo surface stay |
| Surveyor 1 | 1966 | 2 days | Solar + battery | No | First US robotic soft lander |
| Luna 9 | 1966 | 1 day | Solar + battery | No | First robotic soft landing |
| Luna 17 / Lunokhod 1 | 1970 | 14 days | Solar + battery | No | Long robotic mission with rover |
| Change 4 | 2019 | 30 days | Solar + battery | Yes (Queqiao) | Far-side relay-supported mission |
| Change 5 | 2020 | 2 days | Solar + battery | Yes | Sample-return mission |
| Artemis III | 2026 | 14 days | Solar + battery | No | Modern crewed south-pole reference |

Mission sources:

- Apollo 11: <https://www.nasa.gov/mission/apollo-11/>
- Apollo 17: <https://www.nasa.gov/mission/apollo-17/>
- Surveyor 1: <https://science.nasa.gov/mission/surveyor-1/>
- Luna 9: <https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1966-006A>
- Luna 17: <https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1970-095A>
- Change 4 / Change 5: <https://www.cnsa.gov.cn/english/>
- Artemis III: <https://www.nasa.gov/artemis-iii/>

## Modelling assumptions

- Apollo fuel cells are not a supported power source in the mission model, so
  those presets use the non-solar (RTG) path with an equivalent on-board power
  budget. The UI states this explicitly in the preset note.
- Relay support is a coverage model (`relayCoverage` per `relayPeriodMinutes`),
  not an orbit propagation.
- The presets change mission requirements only; terrain, Sun/Earth ephemerides
  and site coordinates are always the real NASA-derived data of the app.
- Selecting “Current mission profile” restores the application defaults.

Data definition: [`src/core/missionPresets.js`](../src/core/missionPresets.js).
