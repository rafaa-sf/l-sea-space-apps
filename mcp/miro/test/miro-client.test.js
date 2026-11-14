import test from 'node:test'
import assert from 'node:assert/strict'

import { createMiroClient, MiroApiError } from '../src/miro-client.js'
import { tools } from '../src/tools.js'

/**
 * Builds a fake fetch implementation that records calls and returns queued
 * responses.
 * @param {Array<{ status?: number, body?: unknown, headers?: Record<string, string> }>} responses
 */
function fakeFetch(responses) {
  const calls = []
  const queue = [...responses]
  const impl = async (url, init) => {
    calls.push({ url, init })
    const next = queue.shift() ?? { status: 200, body: {} }
    const status = next.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(next.headers ?? {}),
      text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
    }
  }
  return { impl, calls }
}

test('createMiroClient requires an access token', () => {
  assert.throws(
    () => createMiroClient({ accessToken: '', fetchImpl: async () => ({}) }),
    (error) => error instanceof MiroApiError && error.code === 'missing_token',
  )
})

test('listBoards sends an authenticated GET with pagination query', async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: { data: [{ id: 'b1', name: 'Board' }], cursor: 'next', size: 1 } },
  ])
  const client = createMiroClient({ accessToken: 'test-token', fetchImpl: impl })

  const page = await client.listBoards({ limit: 10, cursor: 'abc', query: 'lunar' })

  assert.deepEqual(page, { data: [{ id: 'b1', name: 'Board' }], cursor: 'next', size: 1 })
  assert.equal(calls.length, 1)
  const { url, init } = calls[0]
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.Authorization, 'Bearer test-token')
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://api.miro.com')
  assert.equal(parsed.pathname, '/v2/boards')
  assert.equal(parsed.searchParams.get('limit'), '10')
  assert.equal(parsed.searchParams.get('cursor'), 'abc')
  assert.equal(parsed.searchParams.get('query'), 'lunar')
})

test('retries on 429 and succeeds on the next attempt', async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, headers: { 'retry-after': '0' }, body: { message: 'rate limited' } },
    { status: 200, body: { data: [], cursor: null, size: 0 } },
  ])
  const client = createMiroClient({
    accessToken: 'test-token',
    fetchImpl: impl,
    retryBaseMs: 1,
  })

  const page = await client.listItems('board-1', { type: 'sticky_note' })

  assert.equal(calls.length, 2)
  assert.deepEqual(page.data, [])
  assert.equal(new URL(calls[1].url).searchParams.get('type'), 'sticky_note')
})

test('maps Miro API errors to MiroApiError', async () => {
  const { impl } = fakeFetch([
    { status: 404, body: { message: 'Board not found', code: 'not_found' } },
  ])
  const client = createMiroClient({ accessToken: 'test-token', fetchImpl: impl, maxRetries: 0 })

  await assert.rejects(
    () => client.getBoard('missing'),
    (error) =>
      error instanceof MiroApiError &&
      error.status === 404 &&
      error.message === 'Board not found' &&
      error.code === 'not_found',
  )
})

test('createStickyNote serialises the request body', async () => {
  const { impl, calls } = fakeFetch([{ status: 201, body: { id: 'note-1' } }])
  const client = createMiroClient({ accessToken: 'test-token', fetchImpl: impl })

  const created = await client.createStickyNote('board-1', {
    data: { content: 'hello', shape: 'square' },
    position: { x: 10, y: 20, origin: 'center' },
  })

  assert.deepEqual(created, { id: 'note-1' })
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body.data, { content: 'hello', shape: 'square' })
  assert.deepEqual(body.position, { x: 10, y: 20, origin: 'center' })
})

test('updateItem uses the item-type endpoint and PATCH', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { id: 'note-1' } }])
  const client = createMiroClient({ accessToken: 'test-token', fetchImpl: impl })

  await client.updateItem('board-1', 'sticky_notes', 'note-1', {
    data: { content: 'updated' },
  })

  const parsed = new URL(calls[0].url)
  assert.equal(parsed.pathname, '/v2/boards/board-1/sticky_notes/note-1')
  assert.equal(calls[0].init.method, 'PATCH')
})

test('tool definitions are complete and unique', () => {
  assert.ok(tools.length >= 12, `expected at least 12 tools, got ${tools.length}`)
  const names = new Set()
  for (const tool of tools) {
    assert.match(tool.name, /^miro_[a-z_]+$/)
    assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`)
    names.add(tool.name)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 10)
    assert.equal(typeof tool.handler, 'function')
    assert.equal(typeof tool.inputSchema, 'object')
  }
  assert.ok(names.has('miro_list_boards'))
  assert.ok(names.has('miro_create_sticky_note'))
  assert.ok(names.has('miro_create_connector'))
})

test('sticky note tool handler builds a Miro payload', async () => {
  const tool = tools.find((entry) => entry.name === 'miro_create_sticky_note')
  assert.ok(tool)

  let captured = null
  const fakeClient = {
    createStickyNote(boardId, body) {
      captured = { boardId, body }
      return Promise.resolve({ id: 'note-1' })
    },
  }

  await tool.handler(fakeClient, {
    boardId: 'board-1',
    content: 'Lunar site',
    x: 1,
    y: 2,
    color: 'yellow',
    parentFrameId: 'frame-1',
  })

  assert.equal(captured.boardId, 'board-1')
  assert.equal(captured.body.data.content, 'Lunar site')
  assert.equal(captured.body.style.fillColor, 'yellow')
  assert.deepEqual(captured.body.position, { x: 1, y: 2, origin: 'center' })
  assert.deepEqual(captured.body.parent, { id: 'frame-1' })
})
