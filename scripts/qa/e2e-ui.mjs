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
const APP = process.argv[2] || 'http://localhost:4186/?lang=en'
const CDP = (process.argv[3] || 'http://127.0.0.1:9222').replace(/\/$/, '')
const DOWNLOAD_DIR = '/tmp/lsea-e2e-downloads'

import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'

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
    consoleErrors.push(`[${message.params.type}] ` + (message.params.args ?? []).join(' '))
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
const squareCanvas = (canvas) =>
  canvas &&
  canvas.clientWidth > 100 &&
  Math.abs(canvas.clientWidth - canvas.clientHeight) <= 1 &&
  Math.abs(canvas.bufferWidth / canvas.bufferHeight - canvas.clientWidth / canvas.clientHeight) < 0.01
const waitForSquareCanvas = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const canvas = await readCanvas()
    if (squareCanvas(canvas)) return canvas
    await sleep(200)
  }
  return readCanvas()
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
const dragHandle = async (testid, deltaX) => {
  const rect = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  })()`)
  if (!rect) return false
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + deltaX, y: rect.y, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + deltaX, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
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
await evaluate(`localStorage.removeItem('lsea.layout.leftWidth'); localStorage.removeItem('lsea.layout.rightWidth')`)
await send('Page.reload')
await sleep(9000)

const report = { errors: [] }
let text = await bodyText()
report.workerBadge = (text.match(/Worker: [^\n]+/) || [])[0] ?? 'MISSING'
await click('Autopilot', true)
await sleep(800)
text = await bodyText()
report.initialAutopilot = (text.match(/Status: [^\n]+/) || [])[0] ?? 'MISSING'

report.canvas = await waitForSquareCanvas()
report.terrain = await terrainAttributes()
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

report.toggle2d = await click('2D', true)
await sleep(3000)
text = await bodyText()
report.fallbackBanner = section(text, '2D fallback', 180)

report.canvas2d = await waitForSquareCanvas()
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

report.export = await click('Export JSON brief')
await sleep(4000)
const downloads = readdirSync(DOWNLOAD_DIR)
report.downloads = downloads
if (downloads.length > 0) {
  const brief = JSON.parse(readFileSync(`${DOWNLOAD_DIR}/${downloads[0]}`, 'utf8'))
  report.briefSchema = brief.schema
  report.briefSites = Array.isArray(brief.rankedSites) ? brief.rankedSites.length : 'MISSING'
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
if (origin) {
  await send('Page.navigate', { url: `${origin}/?lang=en` })
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
  Boolean(before?.label && after?.label && before.label !== after.label)
const scaleParity = (() => {
  const mpp3d = parseMetersPerPixel(report.scale3d?.caption)
  const mpp2d = parseMetersPerPixel(report.scale2d?.caption)
  const width3d = report.canvas?.clientWidth
  const width2d = report.canvas2d?.clientWidth
  if (!mpp3d || !mpp2d || !width3d || !width2d) return false
  const extent3d = mpp3d * width3d
  const extent2d = mpp2d * width2d
  return Math.abs(extent3d - extent2d) / extent2d < 0.02
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
  !report.scale3d?.label ||
  !squareCanvas(report.canvas) ||
  !squareCanvas(report.canvas2d) ||
  !scaleChanged(report.scale3d, report.scale3dAfterZoom) ||
  !scaleChanged(report.scale2d, report.scale2dAfterZoom) ||
  report.terrain?.layout !== 'rectangular' ||
  !report.terrain?.extent ||
  report.terrain?.markersAnchored !== 'true' ||
  !scaleParity ||
  !(report.railLeftAfterDrag > report.railLeftBefore + 20) ||
  Math.abs((report.railLeftAfterDrag ?? 0) - (report.railLeftAfterReload ?? -999)) > 2 ||
  report.layerCoverage === 'MISSING' ||
  !/Zoom\s+[5-9],/.test(report.layerZoom ?? '') ||
  report.consoleErrors.length > 0
process.exit(failed ? 1 : 0)
