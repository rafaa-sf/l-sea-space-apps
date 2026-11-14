#!/usr/bin/env node
/**
 * filter-results.mjs — re-filter existing result JSON without re-running anything.
 *
 * Contract: qa/SPEC.md §5 (tagging & filtering).
 * Tags: include = AND (must carry every --tag), exclude = ANY (dropped if any
 * --exclude-tag is present). --status filters by result status.
 *
 * Usage:
 *   node filter-results.mjs [--file <results.json>] [--tag <t>]...
 *        [--exclude-tag <t>]... [--status pass|fail|warn] [--format md|json|html|summary]
 *        [--out <file>] [--kind all|ui|logic]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results')

function parse(argv) {
  const a = { file: null, tags: [], excludeTags: [], status: null, format: 'md', out: null, kind: 'all' }
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i]
    const next = () => argv[++i]
    if (x === '--file' || x === '-f') a.file = next()
    else if (x === '--tag') a.tags.push(next())
    else if (x === '--exclude-tag') a.excludeTags.push(next())
    else if (x === '--status') a.status = next()
    else if (x === '--format') a.format = next()
    else if (x === '--out' || x === '-o') a.out = next()
    else if (x === '--kind') a.kind = next()
    else if (x === '--help' || x === '-h') { console.log(usage()); process.exit(0) }
    else { console.error(`Unknown argument: ${x}`); process.exit(2) }
  }
  return a
}
function usage() {
  return `filter-results.mjs — re-filter existing results JSON (no re-run)

  --file <path>          result JSON (default: latest ui-matrix-*.json, or run-all combined)
  --tag <t>              include tag (repeatable; AND semantics)
  --exclude-tag <t>      exclude tag (repeatable; ANY semantics)
  --status pass|fail|warn
  --format md|json|html|summary   (default md)
  --kind all|ui|logic    only when a combined/aggregated file is given
  --out <path>           write output there instead of stdout`
}
function latest(prefix, dir = RESULTS) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] || null
}
function loadResults(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (Array.isArray(data.cases)) return { meta: data.meta || {}, cases: data.cases, source: file }
  if (Array.isArray(data.results)) return { meta: data.meta || {}, cases: data.results, source: file }
  throw new Error(`Unrecognised results file shape: ${file}`)
}
const hasAll = (tags, wanted) => wanted.every((t) => tags.includes(t))
const hasAny = (tags, wanted) => wanted.some((t) => tags.includes(t))

function filter(cases, args) {
  return cases.filter((c) => {
    const tags = c.tags || []
    if (args.tags.length && !hasAll(tags, args.tags)) return false
    if (args.excludeTags.length && hasAny(tags, args.excludeTags)) return false
    if (args.status && c.status !== args.status) return false
    if (args.kind === 'ui' && c.caseKind !== 'ui-matrix') return false
    if (args.kind === 'logic' && c.caseKind !== 'logic-mc') return false
    return true
  })
}

function counts(cases) {
  const byTag = {}
  const byCheck = {}
  for (const c of cases) {
    for (const t of c.tags || []) {
      byTag[t] ??= { total: 0, pass: 0, fail: 0, warn: 0 }
      byTag[t].total++
      byTag[t][c.status] = (byTag[t][c.status] || 0) + 1
    }
    for (const chk of c.checks || []) {
      byCheck[chk.tag] ??= { total: 0, pass: 0, fail: 0 }
      byCheck[chk.tag].total++
      byCheck[chk.tag][chk.status] = (byCheck[chk.tag][chk.status] || 0) + 1
    }
  }
  return { byTag, byCheck }
}

function toMarkdown(res, args) {
  const { meta, cases } = res
  const failed = cases.filter((c) => c.status === 'fail')
  const { byCheck } = counts(cases)
  const lines = []
  lines.push(`# Filtered QA results`)
  lines.push('')
  lines.push(`- Source: \`${res.source}\``)
  lines.push(`- Filter: include=${JSON.stringify(args.tags)} exclude=${JSON.stringify(args.excludeTags)} status=${args.status || 'all'} kind=${args.kind}`)
  if (meta.gitSha) lines.push(`- Repo SHA: \`${meta.gitSha}\``)
  lines.push('')
  lines.push(`## Matches: ${cases.length} case(s) — ${cases.length - failed.length} pass / ${failed.length} fail`)
  lines.push('')
  if (byCheck && Object.keys(byCheck).length) {
    lines.push('| check/tag | total | pass | fail |')
    lines.push('| --- | --- | --- | --- |')
    for (const [tag, v] of Object.entries(byCheck)) lines.push(`| \`${tag}\` | ${v.total} | ${v.pass} | ${v.fail} |`)
    lines.push('')
  }
  if (failed.length) {
    lines.push('### Failures')
    lines.push('')
    lines.push('| case | locale/probe | failed checks | screenshot |')
    lines.push('| --- | --- | --- | --- |')
    for (const c of failed.slice(0, 200)) {
      const fails = (c.checks || []).filter((x) => x.status === 'fail').map((x) => x.tag).join(', ')
      const id = c.device ? `${c.device.id} @${c.device.width}x${c.device.height}` : `case #${c.index}`
      lines.push(`| ${id} | ${c.locale || ''}${c.probe && c.probe !== 'default' ? ' / ' + c.probe : ''} | ${fails} | ${c.screenshot ? '`' + c.screenshot + '`' : ''} |`)
    }
    lines.push('')
  }
  const matchedIds = cases.slice(0, 200).map((c) => (c.device ? c.device.id : `case#${c.index}`))
  lines.push(`Matched case ids (first 200): ${matchedIds.join(', ')}`)
  return lines.join('\n') + '\n'
}

function toJson(res, args) {
  const failed = res.cases.filter((c) => c.status === 'fail').length
  return JSON.stringify({ meta: { ...res.meta, filter: { tags: args.tags, excludeTags: args.excludeTags, status: args.status, kind: args.kind }, source: res.source }, summary: { matched: res.cases.length, pass: res.cases.length - failed, fail: failed }, cases: res.cases }, null, 2)
}

function toHtml(res) {
  const data = JSON.stringify({ meta: res.meta, cases: res.cases }).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Filtered QA results</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}.fail{color:#b00020;font-weight:600}code{font-size:12px}</style></head>
<body><h1>Filtered QA results</h1><p id="meta"></p><table id="t"><thead><tr><th>case</th><th>status</th><th>failed checks</th><th>tags</th></tr></thead><tbody></tbody></table>
<script id="data" type="application/json">${data}</script>
<script>const d=JSON.parse(document.getElementById('data').textContent);const cs=d.cases;document.getElementById('meta').textContent=cs.length+' case(s) · '+cs.filter(c=>c.status==='fail').length+' fail · source '+${JSON.stringify(res.source)};
const tb=document.querySelector('#t tbody');for(const c of cs){const tr=document.createElement('tr');const id=c.device?c.device.id+' @'+c.device.width+'x'+c.device.height:'case #'+c.index;const fails=(c.checks||[]).filter(x=>x.status==='fail').map(x=>x.tag).join(', ');tr.innerHTML='<td>'+id+'</td><td class="'+c.status+'">'+c.status+'</td><td>'+fails+'</td><td><code>'+ (c.tags||[]).join(' ')+'</code></td>';tb.appendChild(tr)}</script>
</body></html>`
}

const args = parse(process.argv)
const file = args.file || latest('ui-matrix-')
if (!file || !existsSync(file)) {
  console.error('No results JSON found. Pass --file <path> or run ui-matrix.mjs first.')
  process.exit(1)
}
const res = loadResults(file)
const matched = filter(res.cases, args)
const filtered = { ...res, cases: matched }
let out
if (args.format === 'json') out = toJson(filtered, args)
else if (args.format === 'html') out = toHtml(filtered)
else if (args.format === 'summary') {
  const failed = matched.filter((c) => c.status === 'fail').length
  out = `matches=${matched.length} pass=${matched.length - failed} fail=${failed} include=${JSON.stringify(args.tags)} exclude=${JSON.stringify(args.excludeTags)} status=${args.status || 'all'}\n`
} else out = toMarkdown(filtered, args)

if (args.out) { writeFileSync(args.out, out); console.log(`wrote ${args.out} (${matched.length} cases)`) }
else process.stdout.write(out)
