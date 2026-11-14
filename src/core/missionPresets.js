/**
 * Historical lunar mission profiles used by the site comparator.
 *
 * These are *approximate* mission-level profiles for comparison, not flight
 * data. They map documented mission characteristics (surface stay, power
 * source, relay support, data volume) onto the L-SEA mission model so the
 * comparator can show how the same south-pole sites behave under different
 * eras of lunar exploration.
 *
 * Sources (mission fact sheets):
 * - NASA Apollo 11: https://www.nasa.gov/mission/apollo-11/
 * - NASA Apollo 17: https://www.nasa.gov/mission/apollo-17/
 * - NASA Surveyor 1: https://science.nasa.gov/mission/surveyor-1/
 * - NASA NSSDC Luna 9: https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1966-006A
 * - NASA NSSDC Luna 17: https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1970-095A
 * - CNSA Chang'e 4: https://www.cnsa.gov.cn/english/
 * - CNSA Chang'e 5: https://www.cnsa.gov.cn/english/
 * - NASA Artemis III: https://www.nasa.gov/artemis-iii/
 *
 * @module core/missionPresets
 */

/**
 * @typedef {Object} MissionPreset
 * @property {string} id Stable preset id.
 * @property {number} year Mission year.
 * @property {string} source Official mission page.
 * @property {Object} mission Fields merged into the mission profile.
 */

/** @type {ReadonlyArray<MissionPreset>} */
export const MISSION_PRESETS = Object.freeze([
  {
    id: 'apollo11',
    year: 1969,
    source: 'https://www.nasa.gov/mission/apollo-11/',
    mission: {
      missionDays: 1,
      powerNeedW: 800,
      sunDaysNeeded: 0,
      batteryCapacityWh: 20000,
      relayInOrbit: false,
      powerSource: 'rtg',
      rtgPowerW: 1500,
      heaterMaxW: 400,
      dataNeedMb: 10,
      mastM: 5,
    },
  },
  {
    id: 'apollo17',
    year: 1972,
    source: 'https://www.nasa.gov/mission/apollo-17/',
    mission: {
      missionDays: 3,
      powerNeedW: 900,
      sunDaysNeeded: 0,
      batteryCapacityWh: 30000,
      relayInOrbit: false,
      powerSource: 'rtg',
      rtgPowerW: 1500,
      heaterMaxW: 400,
      dataNeedMb: 50,
      mastM: 5,
    },
  },
  {
    id: 'surveyor1',
    year: 1966,
    source: 'https://science.nasa.gov/mission/surveyor-1/',
    mission: {
      missionDays: 2,
      powerNeedW: 120,
      sunDaysNeeded: 1,
      batteryCapacityWh: 1500,
      relayInOrbit: false,
      powerSource: 'solar',
      heaterMaxW: 120,
      dataNeedMb: 20,
      mastM: 3,
    },
  },
  {
    id: 'luna9',
    year: 1966,
    source: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1966-006A',
    mission: {
      missionDays: 1,
      powerNeedW: 100,
      sunDaysNeeded: 1,
      batteryCapacityWh: 1000,
      relayInOrbit: false,
      powerSource: 'solar',
      heaterMaxW: 100,
      dataNeedMb: 5,
      mastM: 2,
    },
  },
  {
    id: 'luna17',
    year: 1970,
    source: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1970-095A',
    mission: {
      missionDays: 14,
      powerNeedW: 150,
      sunDaysNeeded: 0,
      batteryCapacityWh: 5000,
      relayInOrbit: false,
      powerSource: 'solar',
      heaterMaxW: 120,
      dataNeedMb: 100,
      mastM: 3,
    },
  },
  {
    id: 'change4',
    year: 2019,
    source: 'https://www.cnsa.gov.cn/english/',
    mission: {
      missionDays: 30,
      powerNeedW: 200,
      sunDaysNeeded: 0,
      batteryCapacityWh: 6000,
      relayInOrbit: true,
      powerSource: 'solar',
      heaterMaxW: 150,
      dataNeedMb: 500,
      mastM: 5,
    },
  },
  {
    id: 'change5',
    year: 2020,
    source: 'https://www.cnsa.gov.cn/english/',
    mission: {
      missionDays: 2,
      powerNeedW: 300,
      sunDaysNeeded: 1,
      batteryCapacityWh: 3000,
      relayInOrbit: true,
      powerSource: 'solar',
      heaterMaxW: 150,
      dataNeedMb: 100,
      mastM: 5,
    },
  },
  {
    id: 'artemis3',
    year: 2026,
    source: 'https://www.nasa.gov/artemis-iii/',
    mission: {
      missionDays: 14,
      powerNeedW: 120,
      sunDaysNeeded: 10,
      batteryCapacityWh: 40000,
      relayInOrbit: false,
      powerSource: 'solar',
      heaterMaxW: 400,
      dataNeedMb: 1200,
      mastM: 10,
    },
  },
])

/** Look up a preset by id. */
export function getMissionPreset(id) {
  return MISSION_PRESETS.find((preset) => preset.id === id) ?? null
}
