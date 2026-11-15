#!/usr/bin/env node
/**
 * Interactive end-to-end check of the L-SEA app in headless Chrome.
 *
 * Prerequisites:
 *   npm run build && npm run preview -- --port 4186 &
 *   google-chrome --headless=new --no-sandbox --remote-debugging-port=9222 &
 *
 * Usage:
 *   node scripts/qa/e2e-ui.mjs [app-url] [cdp-url]
 *
 * Verifies: initial load (worker OK, autopilot result), site selection updates
 * the LOLA panel, comparator selection, 2D fallback, autopilot re-run, and that
 * the JSON brief downloads a valid file. Fails on browser console errors.
 */
// The application opens on a project landing page; the interactive console is
// the hash route #/tool. Normalise any app URL so the E2E always exercises the
// tool regardless of whether the caller included the route.
function withToolRoute(url) {
  const [base, hash = ''] = String(url).split('#')
  if (hash === '/tool' || hash === 'tool') return url
  return `${base}#/tool`
}
const APP = withToolRoute(process.argv[2] || 'http://localhost:4186/?lang=en')
const CDP = (process.argv[3] || 'http://127.0.0.1:9222').replace(/\/$/, '')
const DOWNLOAD_DIR = '/tmp/lsea-e2e-downloads'

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const target = await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}`, {
  method: 'PUT',
}).then((response) => response.json())
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let id = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  if (
    message.method === 'Runtime.consoleAPICalled' &&
    ['error', 'warning'].includes(message.params.type)
  ) {
    const describe = (arg) => {
      if (arg.value !== undefined) return String(arg.value)
      if (arg.description) return String(arg.description)
      if (arg.preview) return JSON.stringify(arg.preview)
      return ''
    }
    consoleErrors.push(`[${message.params.type}] ` + (message.params.args ?? []).map(describe).join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('[exception] ' + (message.params.exceptionDetails?.exception?.description ?? ''))
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const requestId = ++id
    pending.set(requestId, resolve)
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value
const click = (text, exact = false) =>
  evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((candidate) => {
      const value = (candidate.textContent || '').trim();
      return ${exact ? 'value === ' : 'value.includes('}${JSON.stringify(text)}${exact ? '' : ')'};
    });
    if (!button) return 'NOT_FOUND';
    button.click();
    return 'CLICKED';
  })()`)
const readScale = () =>
  evaluate(`(() => {
    const label = document.querySelector('[data-testid="scale-bar-label"]');
    const caption = document.querySelector('[data-testid="scale-bar-caption"]');
    return { label: label?.textContent?.trim() ?? null, caption: caption?.textContent?.trim() ?? null };
  })()`)
const readCanvas = () =>
  evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="viewport-canvas"]');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      clientWidth: Math.round(rect.width),
      clientHeight: Math.round(rect.height),
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
    };
  })()`)
const canvasCentre = () =>
  evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="viewport-canvas"]');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`)
const canvasIsUndistorted = (canvas) =>
  canvas &&
  canvas.clientWidth > 100 &&
  canvas.clientHeight > 100 &&
  Math.abs(canvas.bufferWidth / canvas.bufferHeight - canvas.clientWidth / canvas.clientHeight) < 0.02
const waitForCanvas = async () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const canvas = await readCanvas()
    if (canvasIsUndistorted(canvas)) return canvas
    await sleep(200)
  }
  return readCanvas()
}
const readBreakdown = () =>
  evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="viewport-canvas"]');
    const centre = document.querySelector('[data-testid="layout-center"]');
    if (!canvas || !centre) return null;
    const c = canvas.getBoundingClientRect();
    const m = centre.getBoundingClientRect();
    return {
      canvas: { width: Math.round(c.width), height: Math.round(c.height), x: Math.round(c.x), y: Math.round(c.y) },
      centre: { width: Math.round(m.width), height: Math.round(m.height) },
    };
  })()`)
const siteCounters = () =>
  evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="viewport-canvas"]');
    return {
      visible: Number(canvas?.getAttribute('data-sites-visible') ?? -1),
      outside: Number(canvas?.getAttribute('data-sites-outside') ?? -1),
    };
  })()`)
const canvasAttribute = (name) =>
  evaluate(`document.querySelector('[data-testid="viewport-canvas"]')?.getAttribute(${JSON.stringify(name)}) ?? null`)
const selectDemRegion = async (regionId) => {
  const changed = await evaluate(`(() => {
    const select = document.querySelector('[data-testid="dem-region-select"]');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(regionId)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
  if (!changed) return false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250)
    const region = await canvasAttribute('data-terrain-region')
    if (region === regionId) return true
  }
  return false
}
const waitForScaleLabel = async () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const scale = await readScale()
    if (scale?.label) return scale
    await sleep(150)
  }
  return readScale()
}
const wheelZoom = async (deltaY = -240) => {
  const centre = await canvasCentre()
  if (!centre) return
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: centre.x,
    y: centre.y,
    deltaX: 0,
    deltaY,
  })
  await sleep(900)
}
const parseMetersPerPixel = (caption) => {
  if (!caption) return null
  const match = /([\d.,]+)\s*m\s*\/\s*px|1\s*px\s*=\s*([\d.,]+)\s*m/.exec(caption)
  if (!match) return null
  const value = Number((match[1] ?? match[2] ?? '').replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}
const terrainAttributes = () =>
  evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="viewport-canvas"]');
    const root = document.querySelector('[data-markers-anchored]') ?? document.body;
    return {
      layout: canvas?.getAttribute('data-terrain-layout') ?? null,
      extent: canvas?.getAttribute('data-terrain-extent') ?? null,
      markersAnchored: root?.getAttribute('data-markers-anchored') ?? null,
    };
  })()`)
const railWidth = (testid) =>
  evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().width);
  })()`)
const dragHandle = async (testid, deltaX, deltaY = 0) => {
  const rect = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`)
  if (!rect) return false
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + deltaX, y: rect.y + deltaY, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + deltaX, y: rect.y + deltaY, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(500)
  return true
}
const bodyText = () => evaluate('document.body.innerText')
const section = (text, needle, length = 200) => {
  const index = text.indexOf(needle)
  return index === -1 ? 'MISSING' : text.slice(index, index + length).replace(/\n/g, ' | ')
}

rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DOWNLOAD_DIR,
  eventsEnabled: true,
})
await sleep(9000)

// Start the run from the default pane widths so drag/keyboard assertions are deterministic.
await evaluate(`localStorage.clear()`)
await send('Page.reload')
await sleep(9000)

const report = { errors: [] }
let text = await bodyText()
report.workerBadge = (text.match(/Worker: [^\n]+/) || [])[0] ?? 'MISSING'
await click('Autopilot', true)
await sleep(800)
text = await bodyText()
report.initialAutopilot = (text.match(/Status: [^\n]+/) || [])[0] ?? 'MISSING'

// Playback transport: Now pauses the clock; play advances it; pause stops it.
const timeInput = () => evaluate(`document.querySelector('input[type="time"]')?.value ?? null`)
const transportLabel = () => evaluate(`document.querySelector('.transport-button')?.getAttribute('aria-label') ?? null`)
const clickTransport = () => evaluate(`(() => { document.querySelector('.transport-button')?.click(); return true; })()`)
const clickNow = () => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Now'); if(!b) return false; b.click(); return true; })()`)
report.nowClicked = await clickNow()
await sleep(1600)
const nowTimeA = await timeInput()
await sleep(1400)
const nowTimeB = await timeInput()
report.nowPaused = nowTimeA === nowTimeB
report.nowLabel = await transportLabel()
await clickTransport()
await sleep(1400)
const playTimeA = await timeInput()
await sleep(1400)
const playTimeB = await timeInput()
report.playAdvances = playTimeA !== playTimeB
report.playLabel = await transportLabel()
await clickTransport()
await sleep(1200)
const pauseTimeA = await timeInput()
await sleep(1800)
const pauseTimeB = await timeInput()
report.pauseStops = pauseTimeA === pauseTimeB
report.pauseLabel = await transportLabel()


report.canvas = await waitForCanvas()
report.terrain = await terrainAttributes()
report.hillshadeMode = await canvasAttribute('data-hillshade-mode')
report.terrainRegion = await canvasAttribute('data-terrain-region')
report.sitesInitial = await siteCounters()
report.breakdown = await readBreakdown()

// LOLA DEM region selector: high detail, verify extent + legend, then back to wide.
report.regionHighDetail = await selectDemRegion('south-pole-875s-20m')
await sleep(3000)
report.terrainHighDetail = await terrainAttributes()
let legendHighDetail = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(300)
  legendHighDetail = await evaluate(`document.querySelector('[data-testid="elevation-legend"]')?.textContent ?? null`)
  if (legendHighDetail && /2,?369/.test(legendHighDetail)) break
}
report.sitesHighDetail = await siteCounters()
report.legendHighDetail = legendHighDetail
report.regionWide = await selectDemRegion('south-pole-80s-80m')
await sleep(3000)
report.terrainWide = await terrainAttributes()
report.sitesWideAgain = await siteCounters()
report.regionOptions = await evaluate(`[...(document.querySelector('[data-testid="dem-region-select"]')?.options ?? [])].map((o) => o.value)`)
report.regionPreset = await selectDemRegion('south-pole-300km-1024px')
await sleep(3500)
report.terrainPreset = await terrainAttributes()
report.sitesPreset = await siteCounters()
report.regionBackWide = await selectDemRegion('south-pole-80s-80m')
await sleep(3500)
report.terrainBackWide = await terrainAttributes()
report.canvas = await waitForCanvas()
report.scale3d = await waitForScaleLabel()
const canvasHeightBeforeSplit = report.canvas?.clientHeight ?? 0
const splitFractionBefore = await evaluate(`localStorage.getItem('lsea.layout.mapRatio')`)
const splitDragged = await dragHandle('split-handle-vertical', 0, 60)
await sleep(700)
const canvasAfterSplit = await readCanvas()
report.splitDragged = splitDragged
report.canvasAfterSplit = canvasAfterSplit
report.splitFraction = await evaluate(`localStorage.getItem('lsea.layout.mapRatio')`)
report.splitHeightGain = (canvasAfterSplit?.clientHeight ?? 0) - canvasHeightBeforeSplit
report.splitFractionBefore = splitFractionBefore
report.scale3d = await waitForScaleLabel()
await wheelZoom()
report.scale3dAfterZoom = await waitForScaleLabel()

report.selectSite = await click('de Gerlache rim 1')
await sleep(1000)
// The redesigned analysis rail shows one tab at a time; open Position to read
// the LOLA readout.
await click('Position', true)
await sleep(2000)
text = await bodyText()
report.lolaPanel = section(text, 'COORDINATES & LOLA', 220)

report.compare = await click('Compare', true)
await sleep(2000)
text = await bodyText()
report.comparator = section(text, 'COMPARATOR', 120)
report.presetChanged = await evaluate(`(() => {
  const select = document.querySelector('[data-testid="mission-preset-select"]');
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'apollo11');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
await sleep(4500)
report.presetSelected = await evaluate(`document.querySelector('[data-testid="mission-preset-select"]')?.value ?? null`)
const presetText = await bodyText()
report.presetNote = /Apollo 11/.test(presetText) && /fuel-cell|celdas de combustible/i.test(presetText)
await click('Autopilot', true)
await sleep(1500)
report.presetPowerSource = await evaluate(`document.querySelector('[data-testid="mission-power-source"]')?.value ?? null`)
report.presetRtgPower = await evaluate(`document.querySelector('[data-testid="mission-rtg-power"]')?.value ?? null`)
await click('Compare', true)
await sleep(1200)
report.presetRestored = await evaluate(`(() => {
  const select = document.querySelector('[data-testid="mission-preset-select"]');
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
await sleep(3500)

report.toggle2d = await click('2D', true)
await sleep(3000)
text = await bodyText()
report.fallbackBanner = section(text, '2D fallback', 180)

report.canvas2d = await waitForCanvas()
report.scale2d = await waitForScaleLabel()
await wheelZoom()
report.scale2dAfterZoom = await waitForScaleLabel()

report.toggle3d = await click('3D', true)
await sleep(1500)
report.runRanking = await click('Run ranking')
await sleep(6000)
text = await bodyText()
await click('Autopilot', true)
await sleep(800)
text = await bodyText()
report.ranking = (text.match(/#1[^\n]*\n?[^\n]*/) || [])[0]?.replace(/\n/g, ' ') ?? 'MISSING'
report.zoneRows = await evaluate(`document.querySelectorAll('[data-testid="landing-zone-row"]').length`)
report.zoneFirst = await evaluate(`document.querySelector('[data-testid="landing-zone-row"]')?.textContent ?? null`)
report.zoneClick = await evaluate(`(() => { const row=document.querySelector('[data-testid="landing-zone-row"]'); const el=row?.querySelector('button'); if(!el) return false; el.click(); return true; })()`)
let zoneSelected = false
for (let attempt = 0; attempt < 24 && !zoneSelected; attempt += 1) {
  await sleep(500)
  zoneSelected = await evaluate(`Boolean(document.querySelector('[data-testid="landing-zone-selected"]'))`)
}
await sleep(500)
const zoneBody = await bodyText()
report.zoneHeader = (zoneBody.match(/CURRENT SITE\n([^\n]+)/) || [])[1] ?? null
report.zoneSelected = zoneSelected
await click('Shackleton crater rim', true)
await sleep(1600)
await evaluate(`(() => {
  const tab = document.querySelector('[data-testid="analysis-tab-autopilot"]');
  if (tab) tab.click();
  return true;
})()`)
await sleep(800)
for (let attempt = 0; attempt < 24; attempt += 1) {
  if (await evaluate(`Boolean(document.querySelector('[data-testid="landing-zone-details"]'))`)) break
  await sleep(500)
}
// Expanded zone metrics: Watts, Wh, temperatures and percentages.
await evaluate(`(() => { const b=document.querySelector('[data-testid="landing-zone-details"]'); if(b) b.click(); return true; })()`)
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (await evaluate(`Boolean(document.querySelector('.zone-detail'))`)) break
  await sleep(500)
}
report.zoneMetricsText = await evaluate(`document.querySelector('.zone-detail')?.textContent ?? null`)
const signatureOf = () => evaluate(`document.querySelector('[data-testid="landing-zone-signature"]')?.textContent?.trim() ?? null`)
const zonePanelText = () => bodyText()
const rowStates = () => evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-testid="landing-zone-row"]')];
  return {
    count: rows.length,
    notFeasible: rows.filter((row) => row.innerText.includes('NOT FEASIBLE')).length,
    feasible: rows.filter((row) => row.innerText.includes('FEASIBLE') && !row.innerText.includes('NOT FEASIBLE')).length,
    firstFeasible: rows.length > 0 && rows[0].innerText.includes('FEASIBLE') && !rows[0].innerText.includes('NOT FEASIBLE'),
    order: rows.map((row) => row.innerText.includes('NOT FEASIBLE')),
  };
})()`)
const feasibleFirst = (state) => {
  if (!state || state.count === 0 || !state.firstFeasible) return false
  let sawInfeasible = false
  for (const infeasible of state.order ?? []) {
    if (infeasible) sawInfeasible = true
    else if (sawInfeasible) return false
  }
  return true
}
const defaultRows = await rowStates()
report.defaultRows = defaultRows
report.defaultFeasible = defaultRows.feasible > 0 && feasibleFirst(defaultRows)
report.zoneDuplicateLabels = await evaluate(`(() => {
  const labels = [...document.querySelectorAll('.zone-detail dt')].map((el) => el.textContent.trim());
  const dup = labels.filter((label, index) => labels.indexOf(label) !== index);
  return [...new Set(dup)];
})()`)
report.zoneSignatureBefore = await signatureOf()

const setPowerNeed = (value) => evaluate(`(() => {
  const input = document.querySelector('[data-testid="mission-power-need"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(String(value))});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)

report.powerInputChanged = await setPowerNeed(1200)
let infeasibleSignature = report.zoneSignatureBefore
for (let attempt = 0; attempt < 30 && infeasibleSignature === report.zoneSignatureBefore; attempt += 1) {
  await sleep(500)
  infeasibleSignature = await signatureOf()
}
report.zoneSignatureAfter = infeasibleSignature
report.zoneRecomputed = Boolean(report.zoneSignatureBefore && infeasibleSignature !== report.zoneSignatureBefore)
let infeasibleText = await zonePanelText()
for (let attempt = 0; attempt < 20 && !/NOT FEASIBLE/i.test(infeasibleText); attempt += 1) {
  await sleep(500)
  infeasibleText = await zonePanelText()
}
report.infeasibleSignature = infeasibleSignature
report.infeasibleState = report.zoneRecomputed
const infeasibleRows = await rowStates()
report.infeasibleRows = infeasibleRows
report.infeasibleBadge = infeasibleRows.notFeasible > 0
report.infeasibleAlert = /No fully feasible landing zone|no fully feasible landing zone/i.test(infeasibleText)

report.restorePower = await setPowerNeed(120)
let restoredSignature = infeasibleSignature
for (let attempt = 0; attempt < 30 && restoredSignature === infeasibleSignature; attempt += 1) {
  await sleep(500)
  restoredSignature = await signatureOf()
}
let restoredRows = await rowStates()
for (let attempt = 0; attempt < 30 && restoredRows.count === 0; attempt += 1) {
  await sleep(500)
  restoredRows = await rowStates()
}
for (let attempt = 0; attempt < 30 && restoredRows.feasible === 0; attempt += 1) {
  await sleep(500)
  restoredRows = await rowStates()
}
report.restoredRows = restoredRows
report.restoredFeasible = restoredRows.feasible > 0 && feasibleFirst(restoredRows)

// Task-25: RTG power source feasibility (sufficient then insufficient).
await evaluate(`(() => {
  const tab = document.querySelector('[data-testid="analysis-tab-autopilot"]');
  if (tab) tab.click();
  return Boolean(tab);
})()`)
await sleep(800)
const setPowerSource = (value) =>
  evaluate(`(() => {
    const select = document.querySelector('[data-testid="mission-power-source"]');
    if (!select) return false;
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
const setRtgPower = (value) =>
  evaluate(`(() => {
    const input = document.querySelector('[data-testid="mission-rtg-power"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
const waitSignature = async (previous) => {
  let current = previous
  for (let attempt = 0; attempt < 40 && current === previous; attempt += 1) {
    await sleep(500)
    current = await signatureOf()
  }
  return current
}
report.powerNeedRestored = await evaluate(`document.querySelector('[data-testid="mission-power-need"]')?.value ?? null`)
const sigBeforeRtg = await signatureOf()
report.rtgSourceChanged = await setPowerSource('rtg')
let sigRtgSource = await waitSignature(sigBeforeRtg)
report.rtgPowerSet = await setRtgPower(1000)
const sigRtg1000 = await waitSignature(sigRtgSource)
await sleep(900)
let rtgRows2 = await rowStates()
for (let attempt = 0; attempt < 40 && !(rtgRows2.count > 0 && rtgRows2.feasible === rtgRows2.count); attempt += 1) {
  await sleep(500)
  rtgRows2 = await rowStates()
}
report.rtgFeasibleRows = rtgRows2
report.rtgFeasible = rtgRows2.count > 0 && rtgRows2.feasible === rtgRows2.count
await evaluate(`(() => {
  if (!document.querySelector('.zone-detail')) {
    const details = document.querySelector('[data-testid="landing-zone-row"] .rank-item__details');
    if (details) details.click();
  }
  return Boolean(document.querySelector('.zone-detail'));
})()`)
await sleep(600)
let rtgPanel = await zonePanelText()
for (let attempt = 0; attempt < 20 && !/RTG mission|eclipse|continuous-sun/i.test(rtgPanel); attempt += 1) {
  await sleep(500)
  rtgPanel = await zonePanelText()
}
report.rtgNote = /RTG mission|eclipse|continuous-sun/i.test(rtgPanel)
report.rtgInsufficientPowerSet = await setRtgPower(50)
const sigRtgLow = await waitSignature(sigRtg1000)
await sleep(900)
let rtgBadRows2 = await rowStates()
for (let attempt = 0; attempt < 40 && !(rtgBadRows2.count > 0 && rtgBadRows2.notFeasible > 0); attempt += 1) {
  await sleep(500)
  rtgBadRows2 = await rowStates()
}
report.rtgInsufficientRows = rtgBadRows2
report.rtgInsufficient = rtgBadRows2.notFeasible > 0
let rtgBadPanel = await zonePanelText()
for (let attempt = 0; attempt < 20 && !/RTG|insufficient|no cubre/i.test(rtgBadPanel); attempt += 1) {
  await sleep(500)
  rtgBadPanel = await zonePanelText()
}
report.rtgViolationText = /RTG|insufficient|no cubre/i.test(rtgBadPanel)
await setPowerSource('solar')
await sleep(800)
report.rtgRestored = (await evaluate(`document.querySelector('[data-testid="mission-power-source"]')?.value ?? null`)) === 'solar'

// Mission cycles: weekly sunlight and link/relay strips.
report.cyclesTab = await click('Cycles', true)
let cyclesReady = 0
for (let attempt = 0; attempt < 30 && cyclesReady === 0; attempt += 1) {
  await sleep(400)
  cyclesReady = await evaluate(`document.querySelectorAll('[data-testid="cycles-sun"] button').length`)
}
report.cyclesSunSegments = cyclesReady
report.cyclesDirectSegments = await evaluate(`document.querySelectorAll('[data-testid="cycles-direct"] button').length`)
report.cyclesRelaySegments = await evaluate(`document.querySelectorAll('[data-testid="cycles-relay"] button').length`)
report.cyclesWeeks = await evaluate(`document.querySelectorAll('.cycles-week-label').length`)
report.cyclesSummaryBefore = await evaluate(`document.querySelector('[data-testid="cycles-summary"]')?.textContent ?? null`)
const clockValue = () => evaluate(`document.body.innerText.match(/MISSION TIME \\(UTC\\)\\s*\\n?([^\\n]+)/)?.[1] ?? null`)
report.cyclesRelayToggled = await evaluate(`(() => { const el=document.querySelector('[data-testid="cycles-relay-toggle"]'); if(!el) return false; el.click(); return true; })()`)
let cyclesSummaryAfter = report.cyclesSummaryBefore
for (let attempt = 0; attempt < 30 && cyclesSummaryAfter === report.cyclesSummaryBefore; attempt += 1) {
  await sleep(500)
  cyclesSummaryAfter = await evaluate(`document.querySelector('[data-testid="cycles-summary"]')?.textContent ?? null`)
}
report.cyclesSummaryAfter = cyclesSummaryAfter
report.cyclesRelayRowText = await evaluate(`document.querySelector('[data-testid="cycles-relay"]')?.textContent ?? null`)
const timeBeforeCycles = await clockValue()
report.cyclesTimeBeforeSeek = timeBeforeCycles
report.cyclesSeekClicked = await evaluate(`(() => { const els=[...document.querySelectorAll('[data-testid="cycles-direct"] .cycles-segment--link, [data-testid="cycles-sun"] .cycles-segment')]; const el=els[els.length-1]; if(!el) return false; el.click(); return true; })()`)
await sleep(1200)
report.cyclesTimeAfterSeek = await clockValue()
report.cyclesSeekWorks = Boolean(report.cyclesSeekClicked && report.cyclesTimeAfterSeek && report.cyclesTimeAfterSeek !== timeBeforeCycles)

// Task-29: feasible mission date per zone and timeline jump (Artemis III preset).
await evaluate(`(() => {
  const compare = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Compare');
  if (compare) compare.click();
  return Boolean(compare);
})()`)
await sleep(600)
report.presetApplied = await evaluate(`(() => {
  const select = document.querySelector('[data-testid="mission-preset-select"]');
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'apollo11');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
report.datePresetApplied = report.presetApplied
await sleep(1200)
await evaluate(`(() => {
  const tab = document.querySelector('[data-testid="analysis-tab-autopilot"]');
  if (tab) tab.click();
  return Boolean(tab);
})()`)
const signatureBeforeDates = await signatureOf()
const dateRows = async () =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('.zone-date[data-testid^="ap-date-"]')];
    return rows.map((row) => ({
      hook: row.dataset.testid ?? null,
      text: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
      hasDate: /Feasible mission date|Fecha de misión viable/i.test(row.textContent || ''),
      noDate: /No feasible date|No hay fecha viable/i.test(row.textContent || ''),
    }));
  })()`)
let dateRowsState = await dateRows()
for (let attempt = 0; attempt < 40 && dateRowsState.every((row) => !row.hasDate); attempt += 1) {
  await sleep(500)
  dateRowsState = await dateRows()
}
report.dateRows = dateRowsState
report.dateRowsWithDate = dateRowsState.filter((row) => row.hasDate).length
report.dateRowsWithoutDate = dateRowsState.filter((row) => row.noDate).length
report.dateSearchMeta = await evaluate(`document.querySelector('.date-search-meta')?.textContent?.trim() ?? null`)
report.dateSearchNoDateAlert = await evaluate(`document.querySelector('[data-testid="ap-no-feasible-date"]')?.textContent?.trim() ?? null`)
report.dateSearchToggle = await evaluate(`document.querySelector('[data-testid="ap-date-search-toggle"]')?.checked ?? null`)
report.dateSearchStep = await evaluate(`document.querySelector('[data-testid="ap-date-step"]')?.value ?? null`)
const missionClock = () => evaluate(`(() => {
  const date = document.querySelector('input[type="date"]')?.value ?? '';
  const time = document.querySelector('input[type="time"]')?.value ?? '';
  return date && time ? (date + 'T' + time) : null;
})()`)
for (let attempt = 0; attempt < 40; attempt += 1) {
  const ready = await evaluate(`Boolean(document.querySelector('.zone-date[data-testid^="ap-date-"] button'))`)
  if (ready) break
  await sleep(500)
}
const dateSet = await evaluate(`(() => {
  const input = document.querySelector('input[type="date"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '2026-11-20');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
await sleep(1200)
report.dateSetDifferent = dateSet
const dateBeforeJump = await missionClock()
let dateJumpButton = false
for (let attempt = 0; attempt < 30 && !dateJumpButton; attempt += 1) {
  await sleep(500)
  dateJumpButton = await evaluate(`Boolean(document.querySelector('[data-testid^="ap-date-"] button'))`)
}
report.dateJumpClicked = dateJumpButton && (await evaluate(`(() => {
  const button = document.querySelector('[data-testid^="ap-date-"] button');
  if (!button) return false;
  button.click();
  return true;
})()`))
await sleep(3000)
report.dateJump = { before: dateBeforeJump, after: await missionClock() }
report.dateJumpChanged = Boolean(dateBeforeJump && report.dateJump.after && report.dateJump.after !== dateBeforeJump)
const signatureBeforeStep = await signatureOf()
report.dateStepChanged = await evaluate(`(() => {
  const select = document.querySelector('[data-testid="ap-date-step"]');
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '24');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
let signatureAfterStep = signatureBeforeStep
let stepMetaText = ''
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(500)
  signatureAfterStep = await signatureOf()
  stepMetaText = await evaluate(`document.querySelector('.date-search-meta')?.textContent?.trim() ?? ''`)
  if (/step 24 h/.test(stepMetaText) && signatureAfterStep !== signatureBeforeStep) break
}
report.dateStepMeta = stepMetaText
report.dateStepValue = await evaluate(`document.querySelector('[data-testid="ap-date-step"]')?.value ?? null`)
report.dateStepRecomputed = /step 24 h/.test(stepMetaText) || report.dateStepValue === '24'
report.dateStepSignature = signatureAfterStep
await click('Compare', true)
await sleep(1000)
await evaluate(`(() => {
  const select = document.querySelector('[data-testid="mission-preset-select"]');
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`)
await sleep(2500)

report.export = await click('Export JSON brief')
await sleep(4000)
const downloads = readdirSync(DOWNLOAD_DIR)
report.downloads = downloads
const briefFile = downloads
  .filter((name) => name.endsWith('.json'))
  .sort((a, b) => statSync(`${DOWNLOAD_DIR}/${a}`).mtimeMs - statSync(`${DOWNLOAD_DIR}/${b}`).mtimeMs)
  .at(-1)
if (briefFile) {
  try {
    const brief = JSON.parse(readFileSync(`${DOWNLOAD_DIR}/${briefFile}`, 'utf8'))
    report.briefSchema = brief.schema
    report.briefSites = Array.isArray(brief.rankedSites) ? brief.rankedSites.length : 'MISSING'
    report.briefZones = Array.isArray(brief.rankedLandingZones) ? brief.rankedLandingZones.length : -1
    report.briefZoneMetrics = Boolean(brief.rankedLandingZones?.[0]?.metrics?.power?.averageW != null && brief.rankedLandingZones?.[0]?.metrics?.thermal != null)
  report.briefCycles = Boolean(brief.cycles && brief.cycles.sunlight && brief.cycles.direct)
  } catch (error) {
    report.briefParseError = String(error)
  }
}

report.railLeftBefore = await railWidth('layout-left-rail')
report.resizeHandleDragged = await dragHandle('resize-handle-left', 90)
report.railLeftAfterDrag = await railWidth('layout-left-rail')
report.canvasAfterDrag = await readCanvas()
report.scaleAfterDrag = await waitForScaleLabel()

await sleep(3000)
report.storagePersisted = await evaluate(`localStorage.getItem('lsea.layout.leftWidth')`)
await send('Page.reload')
await sleep(9000)
report.railLeftAfterReload = await railWidth('layout-left-rail')
const focusHandle = await evaluate(`(() => {
  const el = document.querySelector('[data-testid="resize-handle-left"]');
  if (!el) return false; el.focus(); return true;
})()`)
if (focusHandle) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
  await sleep(500)
}
report.railLeftAfterKeyboard = await railWidth('layout-left-rail')
// Moon Trek layer coverage/zoom check: open the layer panel and toggle the
// first WMTS layer like a user would, then poll until the renderer reports the
// per-layer zoom and tile count.
const origin = await evaluate('location.origin')
const basePath = await evaluate('location.pathname')
if (origin) {
  // Preserve a deployment base path (GitHub Pages serves the app under
  // /l-sea-space-apps/); hash routing keeps the tool route valid.
  await send('Page.navigate', { url: `${origin}${basePath}?lang=en#/tool` })
  await sleep(9000)
  await click('Layers')
  await sleep(1500)
  await evaluate(`(() => {
    const box = document.querySelector('[role="dialog"] input[type="checkbox"]');
    if (box && !box.checked) box.click();
    return Boolean(box);
  })()`)
  let coverage = null
  let zoom = null
  for (let attempt = 0; attempt < 60 && !(coverage && zoom); attempt += 1) {
    const layerDialog = await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText : ''; })()`)
    coverage = /Coverage\s+152\s*x\s+152\s*km/.exec(layerDialog)
    zoom = /Zoom\s+\d+,[^\n]*/.exec(layerDialog)
    if (!(coverage && zoom)) await sleep(500)
  }
  report.layerCoverage = coverage ? coverage[0] : 'MISSING'
  report.layerZoom = zoom ? zoom[0] : 'MISSING'
}

ws.close()
await fetch(`${CDP}/json/close/${target.id}`)
const scaleChanged = (before, after) =>
  Boolean(
    before && after &&
    (before.label !== after.label || before.caption !== after.caption),
  )
const scaleParity = (() => {
  const mpp3d = parseMetersPerPixel(report.scale3d?.caption)
  const mpp2d = parseMetersPerPixel(report.scale2d?.caption)
  if (!mpp3d || !mpp2d) return false
  return Math.abs(mpp3d - mpp2d) / mpp2d < 0.03
})()

report.scaleParity = scaleParity
report.consoleErrors = consoleErrors.slice(0, 10)
console.log(JSON.stringify(report, null, 2))

report.consoleErrors = consoleErrors.slice(0, 10)

const failed =
  consoleErrors.length > 0 ||
  report.workerBadge === 'MISSING' ||
  report.downloads.length === 0 ||
  report.briefSchema !== 'lsea.mission-brief/1' ||
  !(report.briefZones >= 1) || !report.briefZoneMetrics ||
  !report.scale3d?.label ||
  !canvasIsUndistorted(report.canvas) ||
  !canvasIsUndistorted(report.canvas2d) ||
  report.hillshadeMode !== 'fixed' ||
  !(report.breakdown && Math.abs(report.breakdown.canvas.width - report.breakdown.centre.width) <= 3) ||
  !(Math.abs(report.splitHeightGain) > 20) ||
  !report.regionHighDetail ||
  !/75840/.test(report.terrainHighDetail?.extent ?? '') ||
  !/2,?369/.test(report.legendHighDetail ?? '') ||
  !report.regionWide ||
  !/304000/.test(report.terrainWide?.extent ?? '') ||
  report.sitesInitial?.visible !== 10 || report.sitesInitial?.outside !== 0 ||
  !(report.sitesHighDetail?.visible >= 3) ||
  report.sitesHighDetail.visible + report.sitesHighDetail.outside !== 10 ||
  !(report.sitesHighDetail.visible < 10) ||
  report.sitesWideAgain?.visible !== 10 ||
  !(Array.isArray(report.regionOptions) && report.regionOptions.length >= 6) ||
  !/150000/.test(report.terrainPreset?.extent ?? '') ||
  report.sitesPreset?.visible !== 9 || report.sitesPreset?.outside !== 1 ||
  !/304000/.test(report.terrainBackWide?.extent ?? '') ||
  !scaleChanged(report.scale3d, report.scale3dAfterZoom) ||
  !scaleChanged(report.scale2d, report.scale2dAfterZoom) ||
  report.terrain?.layout !== 'rectangular' ||
  !report.terrain?.extent ||
  report.terrain?.markersAnchored !== 'true' ||
  !scaleParity ||
  !(report.railLeftAfterDrag > report.railLeftBefore + 20) ||
  Math.abs((report.railLeftAfterDrag ?? 0) - (report.railLeftAfterReload ?? -999)) > 2 ||
  !report.nowClicked || !report.nowPaused || report.nowLabel !== 'Play' ||
  !report.playAdvances || report.playLabel !== 'Pause' ||
  !report.pauseStops || report.pauseLabel !== 'Play' ||
  !(report.zoneRows >= 1) ||
  !/km/.test(report.zoneFirst ?? '') || !/slope/i.test(report.zoneFirst ?? '') ||
  !report.zoneClick || !report.zoneSelected ||
  !/Landing zone/i.test(report.zoneHeader ?? '') ||
  !/\bW\b/.test(report.zoneMetricsText ?? '') || !/Wh/.test(report.zoneMetricsText ?? '') ||
  !/°C/.test(report.zoneMetricsText ?? '') || !/%/.test(report.zoneMetricsText ?? '') ||
  !report.powerInputChanged || !report.zoneRecomputed ||
  !report.defaultFeasible || !Array.isArray(report.zoneDuplicateLabels) || report.zoneDuplicateLabels.length > 0 ||
  !report.infeasibleState || !report.infeasibleBadge || !report.infeasibleAlert ||
  !report.restorePower || !report.restoredFeasible ||
  !report.presetApplied || !report.dateJumpClicked || !report.dateJumpChanged ||
  report.dateRowsWithDate < 1 || !report.dateSearchToggle ||
  !report.dateStepChanged || !report.dateStepRecomputed ||
  !(report.cyclesSunSegments >= 1) || !(report.cyclesDirectSegments >= 1) ||
  !(report.cyclesWeeks >= 2) || !report.cyclesRelayToggled ||
  report.cyclesSummaryAfter === report.cyclesSummaryBefore ||
  !report.cyclesSeekWorks ||
  !report.rtgSourceChanged || !report.rtgPowerSet ||
  !report.rtgFeasible || !report.rtgNote ||
  !report.rtgInsufficient || !report.rtgViolationText || !report.rtgRestored ||
  !report.presetChanged || report.presetSelected !== 'apollo11' || !report.presetNote ||
  report.presetPowerSource !== 'rtg' || report.presetRtgPower !== '1500' || !report.presetRestored ||
  report.layerCoverage === 'MISSING' ||
  !/Zoom\s+[5-9],/.test(report.layerZoom ?? '') ||
  report.consoleErrors.length > 0
process.exit(failed ? 1 : 0)
