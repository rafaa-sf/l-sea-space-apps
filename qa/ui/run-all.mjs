#!/usr/bin/env node
/**
 * run-all.mjs — aggregator for the Monte Carlo test bench.
 *
 * Contract: qa/SPEC.md §5. Loads the latest ui-matrix + logic-mc result
 * JSONs (or runs neither), applies include/exclude tag + status filters, writes:
 *   results/summary.md   — totals, per-tag and per-check summaries, top failures
 *   results/index.html   — SELF-CONTAINED, OFFLINE, filterable report (no CDN)
 *
 * Usage:
 *   node run-all.mjs [--tag <t>]... [--exclude-tag <t>]... [--status pass|fail|warn]
 *                    [--ui-file <json>] [--logic-file <json>] [--out-dir results]
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const QA_DIR = resolve(HERE, '..')
const RESULTS = join(HERE, 'results')

function parse(argv) {
  const a = { tags: [], excludeTags: [], status: null, uiFile: null, logicFile: null, outDir: RESULTS, generatedAt: new Date().toISOString() }
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i]
    const next = () => argv[++i]
    if (x === '--tag') a.tags.push(next())
    else if (x === '--exclude-tag') a.excludeTags.push(next())
    else if (x === '--status') a.status = next()
    else if (x === '--ui-file') a.uiFile = next()
    else if (x === '--logic-file') a.logicFile = next()
    else if (x === '--out-dir') a.outDir = resolve(process.cwd(), next())
    else if (x === '--help' || x === '-h') { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0) }
    else { console.error(`Unknown argument: ${x}`); process.exit(2) }
  }
  return a
}
const hasAll = (t, w) => w.every((x) => t.includes(x))
const hasAny = (t, w) => w.some((x) => t.includes(x))
function latest(prefix, dir = RESULTS) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] || null
}
function load(file) {
  if (!file || !existsSync(file)) return null
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const cases = (data.cases || data.results || []).map((c) => ({ ...c, caseKind: c.caseKind || (data.meta?.kind || 'unknown') }))
  return { meta: data.meta || {}, summary: data.summary || {}, cases, aggregate: null, file }
}

/** Stream a logic-mc cases .ndjson file and aggregate without holding every case in memory. */
async function loadLogicNdjson(file, args) {
  if (!file || !existsSync(file)) return null
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  const byTag = {}
  const byCheck = {}
  const topFailures = []
  let cases = 0, pass = 0, fail = 0, warn = 0, lineNo = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    lineNo++
    let c
    try { c = JSON.parse(line) } catch { continue }
    const tags = c.tags || []
    if (args.tags.length && !hasAll(tags, args.tags)) continue
    if (args.excludeTags.length && !hasAny(tags, args.excludeTags)) continue
    if (args.status && c.status !== args.status) continue
    cases++
    if (c.status === 'pass') pass++
    else if (c.status === 'fail') fail++
    else warn++
    for (const t of tags) {
      byTag[t] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
      byTag[t].total++
      byTag[t][c.status] = (byTag[t][c.status] || 0) + 1
    }
    for (const chk of c.checks || []) {
      byCheck[chk.tag] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
      byCheck[chk.tag].total++
      byCheck[chk.tag][chk.status] = (byCheck[chk.tag][chk.status] || 0) + 1
    }
    if (c.status === 'fail' && topFailures.length < 100) {
      topFailures.push({
        kind: 'logic-mc', id: 'case#' + c.index, locale: null, probe: null,
        failed: (c.checks || []).filter((x) => x.status === 'fail').map((x) => x.tag),
        seed: c.caseSeed ?? null, index: c.index,
      })
    }
  }
  return {
    meta: { kind: 'logic-mc', file, lines: lineNo, note: 'aggregated from streaming .ndjson (cases not embedded)' },
    summary: {}, cases: [], aggregate: { cases, pass, fail, warn, byTag, byCheck, topFailures }, file,
  }
}

/** Load the newest logic-mc artefacts: prefer the JSON (with cases), else stream the .ndjson. */
async function loadLogic(args) {
  if (args.logicFile) {
    if (args.logicFile.endsWith('.ndjson')) return await loadLogicNdjson(args.logicFile, args)
    return load(args.logicFile)
  }
  // logic-mc results are written by the test bench to qa/results/
  // (shared results dir) or in this folder's results/ if copied here.
  const dirs = [join(QA_DIR, 'results'), RESULTS]
  // Prefer the streamed ndjson: a full 20k-trial logic JSON can be ~40 MB and
  // must not be embedded wholesale in the offline HTML report.
  for (const dir of dirs) {
    const nd = latestFile('logic-mc-', '.cases.ndjson', dir)
    if (nd) return await loadLogicNdjson(nd, args)
  }
  for (const dir of dirs) {
    const json = latest('logic-mc-', dir)
    if (!json) continue
    const loaded = load(json)
    if (loaded.cases.length > 2000) {
      // Aggregate big logic JSONs instead of holding every case in memory.
      const byTag = {}, byCheck = {}
      const bump = (o, k, st) => { o[k] ??= { total: 0, pass: 0, fail: 0, warn: 0 }; o[k].total++; o[k][st] = (o[k][st] || 0) + 1 }
      let pass = 0, fail = 0, warn = 0
      const topFailures = []
      for (const c of loaded.cases) {
        const tags = c.tags || []
        if (args.tags.length && !hasAll(tags, args.tags)) continue
        if (args.excludeTags.length && !hasAny(tags, args.excludeTags)) continue
        if (args.status && c.status !== args.status) continue
        if (c.status === 'pass') pass++; else if (c.status === 'fail') fail++; else warn++
        for (const t of tags) bump(byTag, t, c.status)
        for (const chk of c.checks || []) bump(byCheck, chk.tag, chk.status)
        if (c.status === 'fail' && topFailures.length < 100) topFailures.push({ kind: 'logic-mc', id: 'case#' + c.index, failed: (c.checks || []).filter((x) => x.status === 'fail').map((x) => x.tag), seed: c.seed ?? null })
      }
      return { meta: loaded.meta, summary: {}, cases: [], aggregate: { cases: pass + fail + warn, pass, fail, warn, byTag, byCheck, topFailures }, file: json }
    }
    return loaded
  }
  return null
}
function latestFile(prefix, suffix, dir = RESULTS) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] || null
}

function filterCases(cases, args) {
  return cases.filter((c) => {
    const tags = c.tags || []
    if (args.tags.length && !hasAll(tags, args.tags)) return false
    if (args.excludeTags.length && hasAny(tags, args.excludeTags)) return false
    if (args.status && c.status !== args.status) return false
    return true
  })
}

function aggregate(ui, logic, args) {
  const uiCases = ui ? filterCases(ui.cases, args) : []
  const logicCases = logic ? filterCases(logic.cases, args) : []
  const logicAgg = logic?.aggregate || null
  const cases = [...uiCases, ...logicCases]
  const fail = cases.filter((c) => c.status === 'fail')
  const warn = cases.filter((c) => c.status === 'warn')
  const byTag = {}
  const byCheck = {}
  const bump = (obj, key, status) => {
    obj[key] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
    obj[key].total++
    obj[key][status] = (obj[key][status] || 0) + 1
  }
  for (const c of cases) {
    for (const t of c.tags || []) bump(byTag, t, c.status)
    for (const chk of c.checks || []) bump(byCheck, chk.tag, chk.status)
  }
  if (logicAgg) {
    for (const [t, v] of Object.entries(logicAgg.byTag)) {
      byTag[t] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
      for (const k of Object.keys(v)) byTag[t][k] = (byTag[t][k] || 0) + v[k]
    }
    for (const [t, v] of Object.entries(logicAgg.byCheck)) {
      byCheck[t] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
      for (const k of Object.keys(v)) byCheck[t][k] = (byCheck[t][k] || 0) + v[k]
    }
  }
  const uiFail = fail.length
  const uiWarn = warn.length
  const uiTotal = uiCases.length
  const logicTotal = logicAgg ? logicAgg.cases : logicCases.length
  const logicFail = logicAgg ? logicAgg.fail : logicCases.filter((c) => c.status === 'fail').length
  const logicWarn = logicAgg ? logicAgg.warn : logicCases.filter((c) => c.status === 'warn').length
  const logicCaseRows = logicCases.filter((c) => c.status === 'fail')
  const topFailures = [
    ...fail.slice(0, 120).map((c) => ({
      kind: c.caseKind,
      id: c.device ? c.device.id : `case#${c.index}`,
      label: c.device ? c.device.label : '',
      locale: c.locale || null,
      probe: c.probe || null,
      failed: (c.checks || []).filter((x) => x.status === 'fail').map((x) => x.tag),
      screenshot: c.screenshot || null,
      seed: c.seed ?? null,
    })),
    ...(logicAgg ? logicAgg.topFailures : logicCaseRows.slice(0, 100).map((c) => ({ kind: 'logic-mc', id: 'case#' + c.index, failed: (c.checks || []).filter((x) => x.status === 'fail').map((x) => x.tag), seed: c.seed ?? null }))),
  ].slice(0, 200)
  return {
    generatedAt: args.generatedAt,
    filter: { tags: args.tags, excludeTags: args.excludeTags, status: args.status },
    sources: { ui: ui?.file || null, logic: logic?.file || null, uiMeta: ui?.meta || null, logicMeta: logic?.meta || null },
    totals: {
      cases: uiTotal + logicTotal,
      pass: (uiTotal - uiFail - uiWarn) + (logicTotal - logicFail - logicWarn),
      fail: uiFail + logicFail,
      warn: uiWarn + logicWarn,
      ui: uiTotal,
      logic: logicTotal,
    },
    byTag,
    byCheck,
    topFailures,
    cases,
    logicAggregate: logicAgg,
  }
}

function renderSummaryMd(agg) {
  const t = agg.totals
  const lines = []
  lines.push('# L-SEA Monte Carlo test bench — combined summary')
  lines.push('')
  lines.push(`- Generated: ${agg.generatedAt}`)
  lines.push(`- Filters: include=${JSON.stringify(agg.filter.tags)} exclude=${JSON.stringify(agg.filter.excludeTags)} status=${agg.filter.status || 'all'}`)
  if (agg.sources.uiMeta?.gitSha) lines.push(`- UI repo SHA: \`${agg.sources.uiMeta.gitSha}\``)
  if (agg.sources.uiMeta?.previewUrl) lines.push(`- UI preview: ${agg.sources.uiMeta.previewUrl}`)
  if (agg.sources.logicMeta?.seed) lines.push(`- Logic seed: ${agg.sources.logicMeta.seed} (repro: \`--seed ${agg.sources.logicMeta.seed} --case <n>\`)`)
  lines.push(`- Sources: ui=${agg.sources.ui || 'none'}; logic=${agg.sources.logic || 'none'}`)
  lines.push('')
  lines.push(`## Totals: ${t.cases} cases · ${t.pass} pass · ${t.fail} fail · ${t.warn} warn`)
  lines.push('')
  lines.push(`- UI matrix cases: ${t.ui}`)
  lines.push(`- Logic MC cases: ${t.logic}`)
  lines.push('')
  if (agg.logicAggregate) {
    const la = agg.logicAggregate
    lines.push('### Logic Monte Carlo — invariants (@inv/*)')
    lines.push('')
    lines.push('| invariant | total | pass | fail |')
    lines.push('| --- | --- | --- | --- |')
    for (const [tag, v] of Object.entries(la.byTag).filter(([k]) => k.startsWith('@inv/')).sort()) {
      lines.push(`| \`${tag}\` | ${v.total} | ${v.pass} | ${v.fail} |`)
    }
    lines.push('')
    if (la.topFailures.length) {
      lines.push(`Logic failures (first ${la.topFailures.length}): ` + la.topFailures.slice(0, 20).map((f) => `${f.id} [${f.failed.join(',')}] seed=${f.seed}`).join('; '))
      lines.push('')
    } else {
      lines.push('No logic failures in the loaded cases.')
      lines.push('')
    }
  }
  lines.push('## Per-tag summary')
  lines.push('')
  lines.push('| tag | total | pass | fail | warn | pass rate |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const [tag, v] of Object.entries(agg.byTag).sort((a, b) => a[0].localeCompare(b[0]))) {
    const rate = ((100 * v.pass) / v.total).toFixed(1) + '%'
    lines.push(`| \`${tag}\` | ${v.total} | ${v.pass} | ${v.fail} | ${v.warn} | ${rate} |`)
  }
  lines.push('')
  lines.push('## Failures by check tag')
  lines.push('')
  lines.push('| check/tag | total | pass | fail |')
  lines.push('| --- | --- | --- | --- |')
  for (const [tag, v] of Object.entries(agg.byCheck).sort((a, b) => b[1].fail - a[1].fail)) {
    lines.push(`| \`${tag}\` | ${v.total} | ${v.pass} | ${v.fail} |`)
  }
  lines.push('')
  lines.push(`## Top failures (${agg.topFailures.length} shown)`)
  lines.push('')
  if (!agg.topFailures.length) lines.push('None — all matching cases passed.')
  else {
    lines.push('| case | locale/probe | failed checks | screenshot |')
    lines.push('| --- | --- | --- | --- |')
    for (const f of agg.topFailures) {
      lines.push(`| ${f.id} ${f.label} | ${f.locale || ''}${f.probe && f.probe !== 'default' ? ' / ' + f.probe : ''} | ${f.failed.join(', ')} | ${f.screenshot ? '`' + f.screenshot + '`' : ''} |`)
    }
  }
  lines.push('')
  lines.push('Filterable report: `results/index.html` (open offline; no CDN). Re-filter JSON with `node filter-results.mjs --tag ... --exclude-tag ...`.')
  return lines.join('\n') + '\n'
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function renderIndexHtml(agg, tagsJson) {
  const data = JSON.stringify({ generatedAt: agg.generatedAt, filter: agg.filter, totals: agg.totals, sources: agg.sources, byTag: agg.byTag, byCheck: agg.byCheck, logicAggregate: agg.logicAggregate, cases: agg.cases }).replace(/</g, '\\u003c')
  const knownTags = new Set(Object.keys(agg.byTag))
  for (const ns of Object.values(tagsJson.namespaces || {})) {
    for (const v of (Array.isArray(ns.values) ? ns.values : [])) knownTags.add(v)
  }
  const byNs = {}
  for (const tag of [...knownTags].sort()) {
    const ns = tag.split('/')[0]
    ;(byNs[ns] ||= []).push(tag)
  }
  const nsOrder = ['@device', '@orientation', '@tier', '@dpr', '@res', '@level', '@type', '@feature', '@ui', '@inv', '@status', '@speed']
  const namespaces = [...new Set([...nsOrder, ...Object.keys(byNs)])].filter((ns) => byNs[ns])
  const checkTags = Object.keys(agg.byCheck).sort()

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>L-SEA Monte Carlo test bench — filterable report</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1420; --panel:#161d2c; --line:#2a3549; --text:#e6ecf5; --dim:#9aa7bc; --ok:#4ade80; --bad:#fb7185; --warn:#fbbf24; --accent:#60a5fa; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f6fa; --panel:#ffffff; --line:#d5dbe6; --text:#111827; --dim:#5b667a; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); font-size:13px; }
  header { padding:16px 20px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:5; }
  h1 { margin:0 0 4px; font-size:18px; }
  .meta { color:var(--dim); font-size:12px; word-break:break-word; }
  main { padding:14px 20px 40px; display:grid; grid-template-columns: 340px minmax(0,1fr); gap:18px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  aside { position:sticky; top:86px; align-self:start; max-height:calc(100vh - 100px); overflow:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
  aside h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:14px 0 6px; }
  aside h2:first-child { margin-top:0; }
  .taglist { display:flex; flex-direction:column; gap:2px; }
  .taglist label { display:flex; gap:6px; align-items:center; font-family:ui-monospace, monospace; font-size:11px; cursor:pointer; }
  input[type=text], select { width:100%; padding:6px 8px; border-radius:7px; border:1px solid var(--line); background:var(--bg); color:var(--text); font:inherit; }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  .row > * { flex:1 1 140px; }
  .counter { font-weight:700; margin:6px 0 12px; font-size:14px; }
  .counter .ok { color:var(--ok); } .counter .bad { color:var(--bad); }
  table { border-collapse:collapse; width:100%; }
  th, td { border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
  th { position:sticky; top:0; background:var(--panel); font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); }
  tr:hover td { background:rgba(96,165,250,.06); }
  .status { font-weight:700; padding:1px 7px; border-radius:999px; font-size:11px; white-space:nowrap; }
  .status.pass { color:var(--ok); border:1px solid var(--ok); }
  .status.fail { color:var(--bad); border:1px solid var(--bad); }
  .status.warn { color:var(--warn); border:1px solid var(--warn); }
  .tag { font-family:ui-monospace, monospace; font-size:10.5px; color:var(--dim); margin-right:4px; white-space:nowrap; }
  .badge { display:inline-block; font-size:10.5px; border:1px solid var(--line); border-radius:999px; padding:0 6px; margin-left:4px; color:var(--dim); }
  .fails { color:var(--bad); font-family:ui-monospace, monospace; font-size:11px; }
  details summary { cursor:pointer; color:var(--accent); }
  .checks { margin:4px 0 0; padding-left:14px; color:var(--dim); font-size:11.5px; }
  .checks li { margin:2px 0; }
  a { color:var(--accent); }
  .empty { color:var(--dim); padding:30px 8px; }
  code { font-family:ui-monospace, monospace; }
</style>
</head>
<body>
<header>
  <h1>L-SEA Monte Carlo test bench — filterable report</h1>
  <div class="meta" id="meta"></div>
</header>
<main>
  <aside>
    <div class="counter" id="counter"></div>
    <h2>Search</h2>
    <input type="text" id="q" placeholder="device id, label, tag, locale…">
    <h2>Status</h2>
    <select id="status"><option value="">all</option><option>pass</option><option>fail</option><option>warn</option></select>
    <h2>Device class</h2>
    <select id="devclass"><option value="">all</option></select>
    <h2>Tags (include = AND)</h2>
    <div id="tags"></div>
    <h2>Exclude tags</h2>
    <div id="excludeTags"></div>
    <h2>Actions</h2>
    <div class="row"><button id="reset">Reset filters</button></div>
  </aside>
  <section>
    <div id="logic"></div>
    <table>
      <thead><tr><th>case</th><th>status</th><th>failed checks</th><th>tags</th><th>evidence</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>No cases match the current filters.</div>
  </section>
</main>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent)
  var cases = DATA.cases || []
  var byNs = ${JSON.stringify(byNs)}
  var nsOrder = ${JSON.stringify(namespaces)}
  var state = { include: new Set(), exclude: new Set(), status: '', devclass: '', q: '' }

  function el(id) { return document.getElementById(id) }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML }

  // meta line
  var m = DATA.sources && DATA.sources.uiMeta ? DATA.sources.uiMeta : {}
  var metaBits = []
  if (DATA.generatedAt) metaBits.push('generated ' + DATA.generatedAt)
  if (m.gitSha) metaBits.push('repo ' + m.gitSha)
  if (m.previewUrl) metaBits.push('preview ' + m.previewUrl)
  if (DATA.filter && (DATA.filter.tags || []).length) metaBits.push('include filter: ' + DATA.filter.tags.join(' '))
  if (DATA.filter && (DATA.filter.excludeTags || []).length) metaBits.push('exclude filter: ' + DATA.filter.excludeTags.join(' '))
  el('meta').textContent = metaBits.join(' · ')

  // device classes
  var classes = {}
  cases.forEach(function (c) { if (c.device && c.device.class) classes[c.device.class] = 1; if (c.caseKind === 'logic-mc') classes['logic'] = 1 })
  Object.keys(classes).sort().forEach(function (cls) { var o = document.createElement('option'); o.value = cls; o.textContent = cls; el('devclass').appendChild(o) })

  // tag checkboxes (only tags present in the data)
  var present = {}
  cases.forEach(function (c) { (c.tags || []).forEach(function (t) { present[t] = (present[t] || 0) + 1 }) })
  var tagsBox = el('tags'), excludeBox = el('excludeTags')
  nsOrder.forEach(function (ns) {
    var tags = (byNs[ns] || []).filter(function (t) { return present[t] })
    if (!tags.length) return
    var h = document.createElement('h2'); h.textContent = ns + ' (' + tags.length + ')'; tagsBox.appendChild(h)
    var wrap = document.createElement('div'); wrap.className = 'taglist'
    tags.forEach(function (t) {
      var lab = document.createElement('label')
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = t
      cb.addEventListener('change', function () { cb.checked ? state.include.add(t) : state.include.delete(t); render() })
      lab.appendChild(cb); lab.appendChild(document.createTextNode(t + ' (' + present[t] + ')'))
      wrap.appendChild(lab)
    })
    tagsBox.appendChild(wrap)
  })
  nsOrder.forEach(function (ns) {
    var tags = (byNs[ns] || []).filter(function (t) { return present[t] })
    if (!tags.length) return
    var h = document.createElement('h2'); h.textContent = ns; excludeBox.appendChild(h)
    var wrap = document.createElement('div'); wrap.className = 'taglist'
    tags.forEach(function (t) {
      var lab = document.createElement('label')
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = t
      cb.addEventListener('change', function () { cb.checked ? state.exclude.add(t) : state.exclude.delete(t); render() })
      lab.appendChild(cb); lab.appendChild(document.createTextNode(t))
      wrap.appendChild(lab)
    })
    excludeBox.appendChild(wrap)
  })

  el('q').addEventListener('input', function (e) { state.q = e.target.value.toLowerCase(); render() })
  el('status').addEventListener('change', function (e) { state.status = e.target.value; render() })
  el('devclass').addEventListener('change', function (e) { state.devclass = e.target.value; render() })
  el('reset').addEventListener('click', function () {
    state.include.clear(); state.exclude.clear(); state.status = ''; state.devclass = ''; state.q = ''
    el('q').value = ''; el('status').value = ''; el('devclass').value = ''
    document.querySelectorAll('aside input[type=checkbox]').forEach(function (cb) { cb.checked = false })
    render()
  })

  function matches(c) {
    var tags = c.tags || []
    for (var i = 0; i < state.include.size; i++) { /* Set iteration below */ }
    var inc = Array.from(state.include), exc = Array.from(state.exclude)
    for (var a = 0; a < inc.length; a++) if (tags.indexOf(inc[a]) === -1) return false
    for (var b = 0; b < exc.length; b++) if (tags.indexOf(exc[b]) !== -1) return false
    if (state.status && c.status !== state.status) return false
    if (state.devclass) {
      var cls = c.caseKind === 'logic-mc' ? 'logic' : (c.device && c.device.class)
      if (cls !== state.devclass) return false
    }
    if (state.q) {
      var hay = [c.caseKind, c.locale, c.probe, c.device ? c.device.id : '', c.device ? c.device.label : '', (tags || []).join(' '), (c.checks || []).map(function (x) { return x.tag }).join(' ')].join(' ').toLowerCase()
      if (hay.indexOf(state.q) === -1) return false
    }
    return true
  }

  function renderLogic() {
    var la = DATA.logicAggregate
    var box = el('logic')
    if (!la) { box.hidden = true; return }
    var inv = Object.keys(la.byTag || {}).filter(function (k) { return k.indexOf('@inv/') === 0 }).sort()
    var html = '<div class="counter">Logic Monte Carlo: ' + la.cases + ' cases · <span class="ok">' + la.pass + ' pass</span> · <span class="bad">' + la.fail + ' fail</span> · ' + la.warn + ' warn <span class="badge">aggregated from streaming cases</span></div>'
    if (inv.length) {
      html += '<table style="margin-bottom:14px"><thead><tr><th>logic invariant</th><th>total</th><th>pass</th><th>fail</th></tr></thead><tbody>'
      inv.forEach(function (k) { var v = la.byTag[k]; html += '<tr><td><code>' + esc(k) + '</code></td><td>' + v.total + '</td><td>' + v.pass + '</td><td class="fails">' + v.fail + '</td></tr>' })
      html += '</tbody></table>'
    }
    if (la.topFailures && la.topFailures.length) {
      html += '<details><summary>Logic failures (' + la.topFailures.length + ' shown)</summary><ul class="checks">' + la.topFailures.map(function (f) { return '<li><strong>FAIL</strong> ' + esc(f.id) + ' [' + esc((f.failed || []).join(' ')) + '] seed=' + esc(f.seed) + '</li>' }).join('') + '</ul></details>'
    }
    box.innerHTML = html
  }

  function render() {
    renderLogic()
    var list = cases.filter(matches)
    var fails = list.filter(function (c) { return c.status === 'fail' }).length
    var warns = list.filter(function (c) { return c.status === 'warn' }).length
    el('counter').innerHTML = '<span class="ok">' + (list.length - fails - warns) + ' pass</span> · <span class="bad">' + fails + ' fail</span> · ' + warns + ' warn · ' + list.length + ' shown / ' + cases.length + ' total'
    var tb = el('rows'); tb.innerHTML = ''
    list.forEach(function (c) {
      var tr = document.createElement('tr')
      var id = c.caseKind === 'logic-mc' ? 'case #' + c.index : ((c.device ? c.device.id : 'case') + ' <span class="badge">' + (c.device ? c.device.width + '×' + c.device.height + ' @' + c.device.dpr + 'x' : '') + '</span>')
      var label = c.caseKind === 'logic-mc' ? (c.caseKind + ' seed ' + (c.seed == null ? '?' : c.seed)) : (c.device ? c.device.label : '')
      var failsList = (c.checks || []).filter(function (x) { return x.status === 'fail' }).map(function (x) { return x.tag })
      var tagsHtml = (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>' }).join('')
      var checksHtml = '<details><summary>' + (c.checks || []).length + ' checks</summary><ul class="checks">' + (c.checks || []).map(function (x) { return '<li><strong>' + (x.status === 'fail' ? 'FAIL' : x.status) + '</strong> ' + esc(x.tag) + ' — ' + esc(x.detail || '') + '</li>' }).join('') + '</ul></details>'
      var shot = c.screenshot ? '<a href="' + esc(c.screenshot) + '" target="_blank" rel="noopener">' + esc(c.screenshot.split('/').pop()) + '</a>' : (c.caseKind === 'logic-mc' ? '<span class="badge">seed ' + (c.seed != null ? c.seed : '?') + '</span>' : '')
      tr.innerHTML = '<td><code>' + id + '</code><br><span class="meta">' + esc(label) + (c.locale ? ' · ' + c.locale : '') + (c.probe && c.probe !== 'default' ? ' · ' + c.probe : '') + '</span></td>' +
        '<td><span class="status ' + esc(c.status) + '">' + esc(c.status) + '</span></td>' +
        '<td class="fails">' + esc(failsList.join(' ')) + '</td>' +
        '<td>' + tagsHtml + '</td>' +
        '<td>' + shot + checksHtml + '</td>'
      tb.appendChild(tr)
    })
    el('empty').hidden = list.length !== 0
  }
  render()
})()
</script>
</body>
</html>
`
}

const args = parse(process.argv)
const tagsJsonPath = join(QA_DIR, 'tags.json')
const tagsJson = existsSync(tagsJsonPath) ? JSON.parse(readFileSync(tagsJsonPath, 'utf8')) : { namespaces: {} }
const ui = load(args.uiFile || latest('ui-matrix-'))
const logic = await loadLogic(args)
if (!ui && !logic) {
  console.error('No results found. Run ui-matrix.mjs and/or logic-mc.mjs first, or pass --ui-file/--logic-file.')
  process.exit(1)
}
mkdirSync(args.outDir, { recursive: true })
const agg = aggregate(ui, logic, args)
writeFileSync(join(args.outDir, 'summary.md'), renderSummaryMd(agg))
writeFileSync(join(args.outDir, 'index.html'), renderIndexHtml(agg, tagsJson))
console.log(`[run-all] cases=${agg.totals.cases} pass=${agg.totals.pass} fail=${agg.totals.fail} warn=${agg.totals.warn}`)
console.log(`[run-all] wrote ${join(args.outDir, 'summary.md')}`)
console.log(`[run-all] wrote ${join(args.outDir, 'index.html')}`)
