#!/usr/bin/env node
/**
 * ui-matrix.mjs — device / resolution UI matrix runner for L-SEA Space Apps.
 *
 * Contract: qa/SPEC.md §4 (device/UI matrix) and §5 (tagging/filtering).
 * Consumer of the REAL built app (read-only): builds `dist/` if stale, serves it
 * with `npm run preview`, drives headless Chrome over CDP (no puppeteer) and
 * emulates every box in qa/devices.json for EN and ES.
 *
 * No new npm dependencies: Node >= 22 (global WebSocket + fetch).
 *
 * Usage:
 *   node ui-matrix.mjs [--devices all|@device/mobile|id1,id2]
 *                      [--locale en,es] [--url <preview-url>]
 *                      [--tag <t>]... [--exclude-tag <t>]...
 *                      [--out results] [--timeout 20000] [--no-build]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const QA_DIR = resolve(HERE, '..')
const REPO = process.env.LSEA_REPO || resolve(QA_DIR, '..')
const RESULTS_DIR = resolve(HERE, 'results')
const SHOTS_DIR = join(RESULTS_DIR, 'shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// npm is installed next to the Node binary in this environment; do not rely on PATH.
const NPM_BIN = process.env.NPM_BIN || join(dirname(process.execPath), 'npm')

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const args = {
    devices: 'all',
    locale: 'en,es',
    url: null,
    tags: [],
    excludeTags: [],
    out: RESULTS_DIR,
    timeout: 20000,
    build: true,
    chrome: process.env.CHROME || 'google-chrome',
    port: null,
    workers: Number(process.env.WORKERS || 4),
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--devices') args.devices = next()
    else if (a === '--locale' || a === '--locales') args.locale = next()
    else if (a === '--url') args.url = next()
    else if (a === '--tag') args.tags.push(next())
    else if (a === '--exclude-tag') args.excludeTags.push(next())
    else if (a === '--out') args.out = resolve(process.cwd(), next())
    else if (a === '--timeout') args.timeout = Number(next())
    else if (a === '--port') args.port = Number(next())
    else if (a === '--workers') args.workers = Number(next())
    else if (a === '--no-build') args.build = false
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return args
}

/* ------------------------------------------------------------------ */
/* Tag helpers (tags.json semantics: include = AND, exclude = ANY)     */
/* ------------------------------------------------------------------ */
const hasAll = (tags, wanted) => wanted.every((t) => tags.includes(t))
const hasAny = (tags, wanted) => wanted.some((t) => tags.includes(t))

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}
function gitSha(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return (r.stdout || '').trim() || null
}
function gitCommitDate(repo) {
  const r = spawnSync('git', ['-C', repo, 'log', '-1', '--format=%cI'], { encoding: 'utf8' })
  return (r.stdout || '').trim() || null
}
async function freePort() {
  return await new Promise((res, rej) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => res(port))
    })
  })
}
async function httpOk(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (r.ok) return true
    } catch { /* not up yet */ }
    await sleep(100)
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Build + preview                                                     */
/* ------------------------------------------------------------------ */
function newestMtime(dir) {
  let newest = 0
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else newest = Math.max(newest, st.mtimeMs)
    }
  }
  walk(dir)
  return newest
}

function buildIfStale(args) {
  const distIndex = join(REPO, 'dist', 'index.html')
  const sources = ['src', 'public', 'index.html', 'package.json', 'vite.config.js']
    .map((p) => join(REPO, p))
    .filter((p) => existsSync(p))
  const newest = Math.max(...sources.map((p) => (statSync(p).isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)))
  const stale = !existsSync(distIndex) || statSync(distIndex).mtimeMs < newest
  if (args.build && stale) {
    console.log('[ui-matrix] dist is stale -> npm run build')
    const r = spawnSync(NPM_BIN, ['run', 'build'], { cwd: REPO, encoding: 'utf8' })
    if (r.status !== 0) {
      console.error(r.stdout)
      console.error(r.stderr)
      throw new Error('npm run build failed')
    }
    console.log('[ui-matrix] build ok')
  } else {
    console.log(`[ui-matrix] reusing dist (stale=${stale}, build=${args.build})`)
  }
}

async function startPreview(urlOverride, portWanted) {
  if (urlOverride) return { url: urlOverride, stop: async () => {} }
  const port = portWanted || (await freePort())
  const child = spawn(NPM_BIN, ['run', 'preview', '--', '--port', String(port), '--strictPort'], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d.toString()))
  child.stderr.on('data', (d) => (output += d.toString()))
  const url = `http://127.0.0.1:${port}/`
  const ok = await httpOk(url, 150)
  if (!ok) {
    child.kill('SIGTERM')
    throw new Error(`preview server did not start on ${url}\n${output}`)
  }
  console.log(`[ui-matrix] preview: ${url}`)
  return {
    url,
    stop: async () => {
      child.kill('SIGTERM')
      await sleep(200)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Minimal CDP client over the global WebSocket                        */
/* ------------------------------------------------------------------ */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.listeners = []
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res())
      this.ws.addEventListener('error', (e) => rej(new Error(`CDP socket error: ${e.message || e}`)))
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || {})})`))
        else resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg)
      }
    })
  }
  on(fn) { this.listeners.push(fn) }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function launchChrome(chromeBin, port) {
  const profile = `/tmp/lsea-ui-matrix-${process.pid}-${Date.now()}`
  const child = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${base}/json/version`)
      if (res.ok) return { child, base, version: await res.json() }
    } catch { /* not up yet */ }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error('headless Chrome did not expose the CDP endpoint')
}

async function openPageTarget(base, browserCdp) {
  const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' })
  let info = null
  for (let i = 0; i < 100; i++) {
    const list = await (await fetch(`${base}/json/list`)).json()
    info = list.find((t) => t.id === targetId && t.webSocketDebuggerUrl)
    if (info) break
    await sleep(50)
  }
  if (!info) throw new Error('Could not find page target ws url')
  const cdp = new Cdp(info.webSocketDebuggerUrl)
  await cdp.ready
  await browserCdp.send('Target.activateTarget', { targetId })
  return { cdp, targetId }
}

/* ------------------------------------------------------------------ */
/* In-page measurement script                                          */
/* ------------------------------------------------------------------ */
const MEASURE_SCRIPT = String.raw`(() => {
  const round = (n) => Math.round(n * 10) / 10
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) }
  }
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0.5 && r.height > 0.5
  }
  const first = (sel) => document.querySelector(sel)
  const scrollAxis = (el) => {
    const cs = getComputedStyle(el)
    return { y: /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1,
             x: /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 }
  }
  const scrollAncestor = (el, axis = 'x') => {
    let p = el.parentElement
    while (p && p !== document.documentElement) {
      const s = scrollAxis(p)
      if (s[axis]) return p
      p = p.parentElement
    }
    return null
  }
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '')
  }

  const de = document.documentElement
  const body = document.body
  const vw = window.innerWidth, vh = window.innerHeight

  // ---- named layout boxes ----
  const boxSelectors = {
    header: '.app-header',
    main: '.app-main',
    footer: '.app-footer',
    center: '.app-center',
    leftColumn: '.app-column--left',
    rightColumn: '.app-column--right',
    viewport: '.viewport',
    viewportCanvas: '.viewport__canvas',
    timeline: '.timeline',
    bootOverlay: '.boot-overlay',
  }
  const boxes = {}
  for (const [name, sel] of Object.entries(boxSelectors)) {
    const el = first(sel)
    if (el) boxes[name] = { ...rect(el), visible: visible(el), position: getComputedStyle(el).position, selector: sel }
  }

  // ---- panels ----
  const panelEls = [...document.querySelectorAll('.panel-card')]
  const panels = panelEls.map((el) => {
    const titleEl = el.querySelector('.panel-card__title')
    return {
      title: titleEl ? titleEl.textContent.trim().slice(0, 60) : '',
      collapsed: el.classList.contains('is-collapsed'),
      rect: rect(el),
      visible: visible(el),
    }
  })
  const visiblePanels = panels.filter((p) => p.visible)

  // ---- horizontal overflow ----
  const docScrollWidth = Math.max(de.scrollWidth, body ? body.scrollWidth : 0)
  const hOverflowPx = round(docScrollWidth - de.clientWidth)
  const hOffenders = []
  for (const el of document.querySelectorAll('body *')) {
    if (hOffenders.length >= 12) break
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > vw + 1.5 || r.left < -1.5) {
      if (scrollAncestor(el, 'x')) continue
      hOffenders.push({ el: describe(el), rect: rect(el) })
    }
  }

  // ---- vertical model ----
  const appShell = first('.app-shell')
  const shellRect = appShell ? rect(appShell) : null
  const vOverflowPx = round(Math.max(de.scrollHeight, body ? body.scrollHeight : 0) - de.clientHeight)
  const fixedBars = ['header', 'footer', 'timeline']
    .map((k) => boxes[k])
    .filter(Boolean)
    .filter((b) => (b.position === 'fixed' || b.position === 'sticky'))
    .filter((b) => b.y < -1.5 || b.bottom > vh + 1.5)
    .map((b) => ({ ...b }))

  // ---- boxes in viewport / scroll container ----
  const boxViolations = []
  for (const [name, b] of Object.entries(boxes)) {
    if (!b.visible) continue
    if (['bootOverlay'].includes(name)) continue
    const el = first(b.selector)
    if (!el) continue
    const canScrollX = !!scrollAncestor(el, 'x')
    const canScrollY = !!scrollAncestor(el, 'y')
    const outX = b.left < -1.5 || b.right > vw + 1.5
    const outY = b.y < -1.5 || b.bottom > vh + 1.5
    if ((outX && !canScrollX) || (outY && !canScrollY)) {
      boxViolations.push({ box: name, rect: { x: b.x, y: b.y, width: b.width, height: b.height }, canScrollX, canScrollY })
    }
  }

  // ---- interactive targets ----
  const targetViolations = []
  for (const el of document.querySelectorAll('button, a[href], [role="button"], select, input[type="range"]')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 24 - 0.5 || r.height < 24 - 0.5) {
      targetViolations.push({ el: describe(el), width: round(r.width), height: round(r.height), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) })
      if (targetViolations.length >= 20) break
    }
  }

  // ---- font sizes ----
  const fontViolations = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!hasOwnText) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (Number.isFinite(fs) && fs < 10) {
      fontViolations.push({ el: describe(el), fontSize: fs, text: el.textContent.trim().slice(0, 40) })
      if (fontViolations.length >= 20) break
    }
  }
  const minFont = (() => {
    let m = 999
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
      if (!hasOwnText) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (Number.isFinite(fs)) m = Math.min(m, fs)
    }
    return m === 999 ? null : round(m)
  })()

  return {
    viewport: { width: vw, height: vh, dpr: round(window.devicePixelRatio) },
    document: { scrollWidth: docScrollWidth, clientWidth: de.clientWidth, scrollHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0), clientHeight: de.clientHeight },
    appShell: shellRect,
    boxes,
    panels,
    summary: {
      visiblePanelCount: visiblePanels.length,
      totalPanelCount: panels.length,
      hasViewportCanvas: !!first('.viewport__canvas'),
      hasLanguageSwitcher: !!first('.locale-switcher'),
      hasExportButton: !!first('.button--primary'),
      title: document.title,
      documentLang: de.lang,
      bodyTextLength: (body ? body.innerText : '').length,
      hOverflowPx,
      vOverflowPx,
      hOffenders,
      fixedBarsOutsideViewport: fixedBars,
      boxViolations,
      targetViolations,
      fontViolations,
      minFontSize: minFont,
    },
  }
})()`

/* ------------------------------------------------------------------ */
/* One run                                                             */
/* ------------------------------------------------------------------ */
async function runOne(ctx, { device, locale, runIndex }) {
  const { cdp, url, noWebgl, timeout } = ctx
  const events = { consoleErrors: [], consoleWarnings: [], exceptions: [], logErrors: [], failedRequests: [] }
  const onEvent = (msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params
      const text = (args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      if (type === 'error') events.consoleErrors.push(text.slice(0, 300))
      else if (type === 'warning') events.consoleWarnings.push(text.slice(0, 300))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      events.exceptions.push((d.exception?.description || d.text || 'exception').slice(0, 300))
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      if (e.level === 'error') events.logErrors.push(`${e.source}: ${e.text}`.slice(0, 300))
    } else if (msg.method === 'Network.loadingFailed') {
      const p = msg.params
      if (!p.canceled && p.errorText !== 'net::ERR_ABORTED') events.failedRequests.push((p.errorText || 'failed').slice(0, 200))
    }
  }
  cdp.on(onEvent)
  try {
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.enable')

    // Device emulation. Very large boxes are rendered at a reduced device pixel
    // ratio: CSS layout (the thing this matrix measures) is unaffected, but the
    // software-GPU headless browser no longer has to rasterise a 5K Three.js
    // canvas, which otherwise makes each run time out. The result records the
    // emulated dpr used (`renderDpr`) alongside the box's nominal dpr.
    const renderDpr = device.width >= 2560 ? Math.min(device.dpr, 0.4) : device.dpr
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: device.width,
      height: device.height,
      deviceScaleFactor: renderDpr,
      mobile: device.mobile,
      screenWidth: device.width,
      screenHeight: device.height,
      screenOrientation: { type: device.height >= device.width ? 'portraitPrimary' : 'landscapePrimary', angle: 0 },
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!device.touch, maxTouchPoints: 5 })
    try {
      await cdp.send('Emulation.setLocaleOverride', { locale: locale === 'es' ? 'es-ES' : 'en-US' })
    } catch { /* older Chrome */ }

    // Per-run init scripts (locale + optional no-WebGL stub)
    const initScripts = []
    const localeScript = `(() => {
      try { localStorage.setItem('lsea.locale', ${JSON.stringify(locale)}) } catch (e) {}
      try { document.documentElement.lang = ${JSON.stringify(locale)} } catch (e) {}
    })()`
    initScripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: localeScript })).identifier)
    // Software-GPU headless Chrome renders the Three.js scene at the full
    // emulated resolution; on very large boxes that makes each frame extremely
    // expensive and stretches capture time. Throttle rAF to ~4 fps so the scene
    // still renders (layout/screenshot evidence stays valid) without saturating
    // the CPU. Only used for boxes >= 2560 px wide.
    if (device.width >= 2560) {
      const throttle = `(() => {
        const orig = window.requestAnimationFrame.bind(window)
        let last = 0
        window.requestAnimationFrame = (cb) => orig((t) => {
          if (t - last < 250) return
          last = t
          cb(t)
        })
      })()`
      initScripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: throttle })).identifier)
    }
    if (noWebgl) {
      const stub = `(() => {
        const orig = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (String(type).toLowerCase().includes('webgl')) return null
          return orig.call(this, type, ...rest)
        }
        try { Object.defineProperty(window, 'WebGLRenderingContext', { value: undefined }) } catch (e) {}
      })()`
      initScripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub })).identifier)
    }

    const targetUrl = `${url}${url.includes('?') ? '&' : '?'}run=${runIndex}`
    const loadPromise = new Promise((res) => {
      const t = setTimeout(res, timeout)
      const off = (msg) => {
        if (msg.method === 'Page.loadEventFired') { clearTimeout(t); res() }
      }
      cdp.listeners.push(off)
    })
    await cdp.send('Page.navigate', { url: targetUrl })
    await loadPromise

    // Wait for the app to boot (overlay removed) and then settle.
    const startedAt = Date.now()
    let booted = false
    let bootedAt = 0
    while (Date.now() - startedAt < timeout) {
      try {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: `(!!document.querySelector('.app-shell') && !document.querySelector('.boot-overlay'))`,
          returnByValue: true,
          awaitPromise: false,
        })
        if (result.value) { booted = true; bootedAt = Date.now(); break }
      } catch { /* navigating */ }
      await sleep(120)
    }
    await sleep(250) // allow canvas/panels to settle

    // Measure
    const measured = await cdp.send('Runtime.evaluate', {
      expression: MEASURE_SCRIPT,
      returnByValue: true,
      awaitPromise: false,
    })
    const m = measured.result.value

    const shotStart = Date.now()
    // Screenshot (large boxes are captured downscaled to <=1920 CSS px wide to keep PNG encoding quick)
    const shotName = `${device.id}-${locale}${noWebgl ? (ctx.autoFallback ? '-layout2d' : '-nowebgl') : ''}.png`
    const shotPath = join(SHOTS_DIR, shotName)
    try {
      const shotParams = { format: 'png', fromSurface: true, captureBeyondViewport: false }
      const shotScale = device.width > 2560 ? Math.min(1, 960 / device.width) : device.width > 1920 ? Math.min(1, 1280 / device.width) : 1
      if (shotScale < 1) {
        shotParams.clip = { x: 0, y: 0, width: device.width, height: device.height, scale: shotScale }
      }
      const shot = await cdp.send('Page.captureScreenshot', shotParams, 60000)
      writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    } catch (e) {
      events.consoleErrors.push(`screenshot failed: ${e.message}`)
    }
    const shotMs = Date.now() - shotStart

    // Evaluate checks
    const s = m.summary
    const checks = []
    const add = (tag, ok, detail) => checks.push({ tag, status: ok ? 'pass' : 'fail', detail })
    add('@ui/no-horizontal-overflow', s.hOverflowPx <= 1 && s.hOffenders.length === 0,
      `scrollWidth-clientWidth=${s.hOverflowPx}px; offenderElements=${s.hOffenders.length}${s.hOffenders.length ? '; e.g. ' + JSON.stringify(s.hOffenders.slice(0, 3)) : ''}`)
    // SPEC: vertical page scrolling is part of the intended mobile scroll model;
    // the failure condition is a clipped fixed/sticky bar (content scroll alone is allowed).
    add('@ui/no-vertical-overflow', s.fixedBarsOutsideViewport.length === 0,
      `documentVerticalScroll=${s.vOverflowPx}px (content scroll allowed); fixedBarsOutsideViewport=${s.fixedBarsOutsideViewport.length}`)
    add('@ui/boxes-in-viewport', s.boxViolations.length === 0,
      `violations=${s.boxViolations.length}${s.boxViolations.length ? '; ' + JSON.stringify(s.boxViolations.slice(0, 5)) : ''}`)
    add('@ui/no-console-errors', events.consoleErrors.length === 0 && events.exceptions.length === 0,
      `consoleErrors=${events.consoleErrors.length}; exceptions=${events.exceptions.length}; logErrors=${events.logErrors.length}; warnings=${events.consoleWarnings.length}; failedRequests=${events.failedRequests.length}${events.consoleErrors.length ? '; first=' + events.consoleErrors[0].slice(0, 160) : ''}${events.logErrors.length ? '; logEntries=' + JSON.stringify(events.logErrors.slice(0, 3)) : ''}`)
    add('@ui/panels-rendered', booted && s.visiblePanelCount >= 10 && s.hasViewportCanvas,
      `booted=${booted}; visiblePanels=${s.visiblePanelCount}/${s.totalPanelCount}; viewportCanvas=${s.hasViewportCanvas}`)
    add('@ui/interactive-targets', s.targetViolations.length === 0,
      `violations=${s.targetViolations.length}${s.targetViolations.length ? '; ' + JSON.stringify(s.targetViolations.slice(0, 5)) : ''}`)
    add('@ui/fonts-readable', (s.minFontSize === null || s.minFontSize >= 10) && s.fontViolations.length === 0,
      `minFontSize=${s.minFontSize}; violations=${s.fontViolations.length}${s.fontViolations.length ? '; ' + JSON.stringify(s.fontViolations.slice(0, 5)) : ''}`)

    const failed = checks.filter((c) => c.status === 'fail')
    const status = failed.length === 0 ? 'pass' : 'fail'

    const tags = [
      ...device.tags,
      '@level/ui',
      '@type/@matrix',
      '@matrix',
      '@feature/i18n',
      noWebgl ? '@feature/render2d' : '@feature/render3d',
      `@status/${status}`,
      '@speed/fast',
    ]

    return {
      index: runIndex,
      caseKind: 'ui-matrix',
      device: { id: device.id, label: device.label, class: device.class, width: device.width, height: device.height, dpr: device.dpr, renderDpr, mobile: device.mobile, touch: device.touch },
      locale,
      probe: noWebgl ? (ctx.autoFallback ? 'layout-2d-fallback' : 'no-webgl') : 'default',
      autoFallback: !!ctx.autoFallback,
      tags: [...new Set(tags)],
      status,
      durationMs: Date.now() - startedAt,
      phases: { bootWaitMs: bootedAt - startedAt, shotMs },
      url: targetUrl,
      screenshot: `shots/${shotName}`,
      checks,
      metrics: {
        viewport: m.viewport,
        document: m.document,
        appShell: m.appShell,
        boxes: m.boxes,
        panels: m.panels,
        summary: {
          booted,
          visiblePanelCount: s.visiblePanelCount,
          totalPanelCount: s.totalPanelCount,
          hasViewportCanvas: s.hasViewportCanvas,
          hasLanguageSwitcher: s.hasLanguageSwitcher,
          hasExportButton: s.hasExportButton,
          documentLang: s.documentLang,
          title: s.title,
          hOverflowPx: s.hOverflowPx,
          vOverflowPx: s.vOverflowPx,
          hOffenders: s.hOffenders,
          boxViolations: s.boxViolations,
          targetViolations: s.targetViolations,
          fontViolations: s.fontViolations,
          minFontSize: s.minFontSize,
          fixedBarsOutsideViewport: s.fixedBarsOutsideViewport,
          warnings: events.consoleWarnings.slice(0, 10),
          consoleErrors: events.consoleErrors.slice(0, 10),
          exceptions: events.exceptions.slice(0, 10),
          logErrors: events.logErrors.slice(0, 10),
          failedRequests: events.failedRequests.slice(0, 10),
        },
      },
    }
  } finally {
    // Clean up per-run listeners/init scripts
    for (const id of (typeof initScripts !== 'undefined' ? initScripts : [])) {
      try { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }, 5000) } catch { /* ignore */ }
    }
    cdp.listeners = cdp.listeners.filter((fn) => fn !== onEvent)
  }
}

/* ------------------------------------------------------------------ */
/* Device selection                                                    */
/* ------------------------------------------------------------------ */
function loadDevices(args) {
  const data = JSON.parse(readFileSync(join(QA_DIR, 'devices.json'), 'utf8'))
  let list = data.devices
  if (args.devices !== 'all') {
    const parts = args.devices.split(',').map((s) => s.trim()).filter(Boolean)
    const includeTags = parts.filter((p) => p.startsWith('@'))
    const ids = parts.filter((p) => !p.startsWith('@'))
    if (ids.length) {
      const wanted = new Set(ids)
      list = list.filter((d) => wanted.has(d.id))
    }
    for (const tag of includeTags) list = list.filter((d) => d.tags.includes(tag))
  }
  if (args.tags.length) list = list.filter((d) => hasAll(d.tags, args.tags))
  if (args.excludeTags.length) list = list.filter((d) => !hasAny(d.tags, args.excludeTags))
  return list
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv)
  const stamp = utcStamp()
  const devices = loadDevices(args)
  const locales = args.locale.split(',').map((s) => s.trim()).filter(Boolean)
  if (!devices.length) throw new Error('No devices matched the selection filter')
  const outDir = args.out || RESULTS_DIR
  mkdirSync(SHOTS_DIR, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  buildIfStale(args)
  const preview = await startPreview(args.url, args.port)
  const sha = gitSha(REPO)
  const commitDate = gitCommitDate(REPO)

  const chromePort = await freePort()
  const chrome = await launchChrome(args.chrome, chromePort)
  const browserCdp = new Cdp(chrome.version.webSocketDebuggerUrl)
  await browserCdp.ready
  const page = await openPageTarget(chrome.base, browserCdp)

  // ---- build the run queue (matrix + no-WebGL probes) ----
  const plan = []
  for (const device of devices) for (const locale of locales) plan.push({ device, locale, noWebgl: false })
  const probes = []
  const byId = new Map(devices.map((d) => [d.id, d]))
  for (const id of ['desk-1920x1080', 'mob-390x844']) {
    if (byId.has(id) && locales.includes('en')) probes.push({ device: byId.get(id), locale: 'en', noWebgl: true })
  }
  // Headless Chrome has no GPU: rasterising the Three.js scene above ~2.5k
  // buffer pixels is too slow to be a reliable matrix run. For those boxes we
  // exercise the documented no-WebGL 2D fallback and record the reason, while
  // 3D is covered on all boxes below the threshold. This keeps layout evidence
  // for every box and is stated explicitly in the report.
  const queue = [...plan, ...probes].map((item, idx) => ({
    ...item,
    autoFallback: !item.noWebgl && item.device.width * item.device.dpr >= 2560,
  })).map((item) => ({ ...item, noWebgl: item.noWebgl || item.autoFallback, idx: 0 }))
  queue.forEach((item, idx) => { item.idx = idx + 1; item.total = queue.length })
  const WORKERS = Math.max(1, Math.min(args.workers || 4, queue.length))
  console.log(`[ui-matrix] ${plan.length} matrix runs + ${probes.length} no-WebGL probes | sha=${sha} | workers=${WORKERS}`)

  // ---- parallel page targets (each tab owns its own emulation state) ----
  const pages = []
  for (let w = 0; w < WORKERS; w++) pages.push(await openPageTarget(chrome.base, browserCdp))
  const cases = []
  let next = 0
  const runner = async (page) => {
    while (true) {
      const item = queue[next++]
      if (!item) return
      const ctx = { cdp: page.cdp, url: preview.url, noWebgl: item.noWebgl, timeout: args.timeout, autoFallback: item.autoFallback }
      try {
        let r
        try {
          r = await runOne(ctx, { device: item.device, locale: item.locale, runIndex: item.idx })
        } catch (firstError) {
          // A single busy tab can time out under load; retry once with fresh emulation.
          console.log(`[${String(item.idx).padStart(3)}/${item.total}] ${item.device.id} ${item.locale} retry after: ${firstError.message}`)
          try { await page.cdp.send('Page.navigate', { url: 'about:blank' }, 5000) } catch { /* reset best-effort */ }
          await sleep(600)
          r = await runOne(ctx, { device: item.device, locale: item.locale, runIndex: item.idx })
        }
        cases.push(r)
        if (r.status === 'fail') console.log(`[${String(item.idx).padStart(3)}/${item.total}] ${item.device.id} ${item.locale}${item.noWebgl ? ' no-webgl' : ''} -> fail | ${r.checks.filter((c) => c.status === 'fail').map((c) => c.tag).join(' ')}`)
        else console.log(`[${String(item.idx).padStart(3)}/${item.total}] ${item.device.id} ${item.locale}${item.noWebgl ? ' no-webgl' : ''} -> pass`)
      } catch (e) {
        cases.push({
          index: item.idx, caseKind: 'ui-matrix', device: { id: item.device.id, label: item.device.label, class: item.device.class, width: item.device.width, height: item.device.height, dpr: item.device.dpr, mobile: item.device.mobile, touch: item.device.touch },
          locale: item.locale, probe: item.noWebgl ? 'no-webgl' : 'default', tags: [...item.device.tags, '@level/ui', '@type/@matrix', '@matrix', '@feature/i18n', '@status/fail'], status: 'fail', durationMs: 0,
          checks: [{ tag: '@ui/no-console-errors', status: 'fail', detail: `runner error: ${e.message}` }], error: e.message,
        })
        console.log(`[${item.idx}/${item.total}] ${item.device.id} ${item.locale} -> RUNNER ERROR: ${e.message}`)
      }
    }
  }
  await Promise.all(pages.map((p) => runner(p)))
  cases.sort((a, b) => a.index - b.index)

  // ---- aggregate ----
  const byTag = {}
  const byCheck = {}
  for (const c of cases) {
    for (const t of c.tags) {
      byTag[t] ??= { total: 0, pass: 0, fail: 0 }
      byTag[t].total++
      byTag[t][c.status]++
    }
    for (const chk of c.checks || []) {
      byCheck[chk.tag] ??= { total: 0, pass: 0, fail: 0 }
      byCheck[chk.tag].total++
      byCheck[chk.tag][chk.status]++
    }
  }
  const fail = cases.filter((c) => c.status === 'fail')
  const offenders = fail
    .map((c) => ({ id: c.device.id, status: c.status, fails: c.checks.filter((x) => x.status === 'fail').map((x) => x.tag) }))
    .slice(0, 30)

  const result = {
    meta: {
      kind: 'ui-matrix',
      version: 1,
      generatedAt: new Date().toISOString(),
      utcStamp: stamp,
      seed: null,
      repo: REPO,
      gitSha: sha,
      gitCommitDate: commitDate,
      previewUrl: preview.url,
      chrome: chrome.version['Browser'],
      devicesFile: join(QA_DIR, 'devices.json'),
      devicesTotal: devices.length,
      locales,
      runs: cases.length,
      noWebglProbes: probes.length,
      tagsFile: join(QA_DIR, 'tags.json'),
      filter: { tags: args.tags, excludeTags: args.excludeTags },
    },
    summary: {
      cases: cases.length,
      pass: cases.length - fail.length,
      fail: fail.length,
      byCheck,
      topOffenders: offenders,
    },
    cases,
  }

  const jsonPath = join(outDir, `ui-matrix-${stamp}.json`)
  writeFileSync(jsonPath, JSON.stringify(result, null, 2))
  const mdPath = join(outDir, `ui-matrix-${stamp}.md`)
  writeFileSync(mdPath, renderMarkdown(result))

  console.log(`\n[ui-matrix] results: ${jsonPath}`)
  console.log(`[ui-matrix] summary: ${mdPath}`)
  console.log(`[ui-matrix] ${result.summary.pass}/${result.summary.cases} pass, ${result.summary.fail} fail`)
  for (const [tag, v] of Object.entries(byCheck)) console.log(`  ${tag.padEnd(34)} ${v.pass}/${v.total} pass`)
  if (offenders.length) {
    console.log('  top failing boxes:')
    for (const o of offenders.slice(0, 10)) console.log(`   - ${o.id}: ${o.fails.join(' ')}`)
  }

  for (const p of pages) p.cdp.close()
  browserCdp.close()
  chrome.child.kill('SIGKILL')
  await preview.stop()
  // Findings are reported, not a harness failure; force exit so CDP/WebSocket
  // and child-process handles do not keep the process alive.
  process.exit(0)
}

function renderMarkdown(result) {
  const m = result.meta
  const lines = []
  lines.push(`# Device / UI matrix — L-SEA Space Apps`)
  lines.push('')
  lines.push(`- Generated: ${m.generatedAt} (UTC)`)
  lines.push(`- Repo: \`${m.repo}\` @ \`${m.gitSha}\` (${m.gitCommitDate})`)
  lines.push(`- Preview URL: ${m.previewUrl}`)
  lines.push(`- Browser: ${m.chrome}`)
  lines.push(`- Boxes: ${m.devicesTotal}; locales: ${m.locales.join(', ')}; runs: ${m.runs}; no-WebGL probes: ${m.noWebglProbes}`)
  lines.push(`- Filters: tag=${JSON.stringify(m.filter.tags)} exclude=${JSON.stringify(m.filter.excludeTags)}`)
  lines.push('')
  lines.push(`## Result: ${result.summary.pass}/${result.summary.cases} pass · ${result.summary.fail} fail`)
  lines.push('')
  lines.push('## Per-@ui check')
  lines.push('')
  lines.push('| check | pass | fail | pass rate |')
  lines.push('| --- | --- | --- | --- |')
  for (const [tag, v] of Object.entries(result.summary.byCheck)) {
    lines.push(`| \`${tag}\` | ${v.pass} | ${v.fail} | ${((100 * v.pass) / v.total).toFixed(1)}% |`)
  }
  lines.push('')
  lines.push('## Failing boxes')
  lines.push('')
  if (!result.summary.topOffenders.length) {
    lines.push('None — every box passed every check.')
  } else {
    lines.push('| device | locale | probe | failed checks |')
    lines.push('| --- | --- | --- | --- |')
    for (const c of result.cases.filter((x) => x.status === 'fail')) {
      lines.push(`| ${c.device.id} (${c.device.width}x${c.device.height} @${c.device.dpr}x) | ${c.locale} | ${c.probe} | ${c.checks.filter((x) => x.status === 'fail').map((x) => x.tag).join(', ')} |`)
    }
  }
  lines.push('')
  lines.push('## Worst offenders by device class')
  lines.push('')
  const byClass = {}
  for (const c of result.cases) {
    byClass[c.device.class] ??= { total: 0, fail: 0 }
    byClass[c.device.class].total++
    if (c.status === 'fail') byClass[c.device.class].fail++
  }
  lines.push('| device class | runs | fails |')
  lines.push('| --- | --- | --- |')
  for (const [cls, v] of Object.entries(byClass)) lines.push(`| ${cls} | ${v.total} | ${v.fail} |`)
  lines.push('')
  lines.push('Screenshots: `results/shots/<device-id>-<locale>[-nowebgl].png`. Raw data: JSON alongside this file.')
  return lines.join('\n') + '\n'
}

main().catch((e) => {
  console.error('[ui-matrix] FATAL:', e.stack || e.message)
  process.exit(1)
})
