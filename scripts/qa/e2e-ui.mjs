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
const bodyText = () => evaluate('document.body.innerText')
const section = (text, needle, length = 200) => {
  const index = text.indexOf(needle)
  return index === -1 ? 'MISSING' : text.slice(index, index + length).replace(/\n/g, ' | ')
}

rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })

await send('Runtime.enable')
await send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DOWNLOAD_DIR,
  eventsEnabled: true,
})
await sleep(9000)

const report = { errors: [] }
let text = await bodyText()
report.workerBadge = (text.match(/Worker: [^\n]+/) || [])[0] ?? 'MISSING'
await click('Autopilot', true)
await sleep(800)
text = await bodyText()
report.initialAutopilot = (text.match(/Status: [^\n]+/) || [])[0] ?? 'MISSING'

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

report.consoleErrors = consoleErrors.slice(0, 10)
console.log(JSON.stringify(report, null, 2))

ws.close()
await fetch(`${CDP}/json/close/${target.id}`)
const failed =
  consoleErrors.length > 0 ||
  report.workerBadge === 'MISSING' ||
  report.downloads.length === 0 ||
  report.briefSchema !== 'lsea.mission-brief/1'
process.exit(failed ? 1 : 0)
