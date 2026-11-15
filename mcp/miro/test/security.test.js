/**
 * Security regression tests for the Miro MCP server (audit SEC-03).
 *
 * These tests exercise the pure configuration/guard helpers and the client's
 * base-URL boundary; they never call the Miro API and never use a real token.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  createMiroClient,
  DEFAULT_MIRO_BASE_URL,
  MiroApiError,
  normalizeMiroBaseUrl,
} from '../src/miro-client.js'
import { tools } from '../src/tools.js'
import {
  MiroConfigError,
  guardToolHandler,
  isEnabled,
  parseBoardIds,
  resolveConfig,
  selectTools,
} from '../src/config.js'

const READ_ONLY_TOOL_NAMES = [
  'miro_get_board',
  'miro_get_item',
  'miro_list_boards',
  'miro_list_items',
  'miro_list_members',
]

const WRITE_TOOL_NAMES = [
  'miro_create_board',
  'miro_create_connector',
  'miro_create_frame',
  'miro_create_shape',
  'miro_create_sticky_note',
  'miro_create_text',
  'miro_update_item',
]

/**
 * @param {ReturnType<typeof resolveConfig>} config
 * @returns {string[]}
 */
function selectedNames(config) {
  return selectTools(tools, config)
    .map((tool) => tool.name)
    .sort()
}

test('read-only tools are the default registration', () => {
  const config = resolveConfig({})
  assert.equal(config.allowWrites, false)
  assert.equal(config.allowDelete, false)
  assert.equal(config.allowDotenv, false)
  assert.deepEqual(selectedNames(config), [...READ_ONLY_TOOL_NAMES].sort())
})

test('MIRO_ALLOW_WRITES opts into write tools but not delete', () => {
  const config = resolveConfig({ MIRO_ALLOW_WRITES: 'true' })
  const names = selectedNames(config)
  assert.equal(config.allowWrites, true)
  assert.equal(config.allowDelete, false)
  for (const name of WRITE_TOOL_NAMES) assert.ok(names.includes(name), `missing ${name}`)
  assert.ok(!names.includes('miro_delete_item'))
  assert.equal(names.length, 12)
})

test('MIRO_ALLOW_DELETE only enables delete together with writes', () => {
  const both = resolveConfig({ MIRO_ALLOW_WRITES: 'true', MIRO_ALLOW_DELETE: 'true' })
  assert.equal(both.allowDelete, true)
  assert.ok(selectedNames(both).includes('miro_delete_item'))

  const deleteOnly = resolveConfig({ MIRO_ALLOW_DELETE: 'true' })
  assert.equal(deleteOnly.allowDelete, false)
  assert.ok(!selectedNames(deleteOnly).includes('miro_delete_item'))

  const writesNoDelete = resolveConfig({
    MIRO_ALLOW_WRITES: 'true',
    MIRO_ALLOW_DELETE: 'false',
  })
  assert.ok(!selectedNames(writesNoDelete).includes('miro_delete_item'))
})

test('boolean opt-ins accept only the documented affirmative values', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(isEnabled(value), true, `expected ${value} to enable`)
  }
  for (const value of ['0', 'false', 'no', '', '  ', 'enabled', undefined, null]) {
    assert.equal(isEnabled(value), false, `expected ${value} to stay disabled`)
  }
  assert.equal(isEnabled(true), true)
})

test('the dotenv token fallback is opt-in', () => {
  assert.equal(resolveConfig({}).allowDotenv, false)
  assert.equal(resolveConfig({ MIRO_ALLOW_DOTENV: 'true' }).allowDotenv, true)
  assert.equal(resolveConfig({ MIRO_ALLOW_DOTENV: '0' }).allowDotenv, false)
})

test('MIRO_BOARD_IDS is parsed as a trimmed, de-duplicated set', () => {
  assert.deepEqual([...parseBoardIds(' board-1, board-2 ,,board-1 ') ], ['board-1', 'board-2'])
  assert.equal(parseBoardIds('').size, 0)
  assert.equal(parseBoardIds(undefined).size, 0)
})

test('an active board allowlist disables creating new boards', () => {
  const readOnly = resolveConfig({ MIRO_BOARD_IDS: 'board-1' })
  assert.ok(!selectedNames(readOnly).includes('miro_create_board'))
  assert.ok(selectedNames(readOnly).includes('miro_get_board'))

  const writes = resolveConfig({ MIRO_BOARD_IDS: 'board-1', MIRO_ALLOW_WRITES: 'true' })
  assert.ok(!selectedNames(writes).includes('miro_create_board'))
  assert.ok(selectedNames(writes).includes('miro_create_sticky_note'))
})

test('the board allowlist is enforced for every board-scoped call', async () => {
  const config = resolveConfig({ MIRO_BOARD_IDS: 'board-1' })
  const tool = {
    name: 'miro_get_board',
    handler: async (client, args) => ({ boardId: args.boardId }),
  }
  const guarded = guardToolHandler(tool, config)

  assert.deepEqual(await guarded({}, { boardId: 'board-1' }), { boardId: 'board-1' })
  await assert.rejects(
    () => guarded({}, { boardId: 'board-2' }),
    (error) => error instanceof MiroConfigError && error.code === 'config_error',
  )
  await assert.rejects(
    () => guarded({}, {}),
    (error) => error instanceof MiroConfigError && error.code === 'config_error',
  )
})

test('creating a board is refused even if the handler is called directly', async () => {
  const config = resolveConfig({ MIRO_BOARD_IDS: 'board-1' })
  const tool = { name: 'miro_create_board', handler: async () => ({ id: 'new-board' }) }

  await assert.rejects(
    () => guardToolHandler(tool, config)({}, { name: 'Escape' }),
    (error) => error instanceof MiroConfigError && error.code === 'config_error',
  )

  const unguarded = guardToolHandler(tool, resolveConfig({ MIRO_ALLOW_WRITES: 'true' }))
  assert.deepEqual(await unguarded({}, { name: 'Allowed' }), { id: 'new-board' })
})

test('listBoards results are filtered to the allowlist', async () => {
  const config = resolveConfig({ MIRO_BOARD_IDS: 'board-1' })
  const tool = {
    name: 'miro_list_boards',
    handler: async () => ({
      data: [{ id: 'board-1', name: 'Allowed' }, { id: 'board-2', name: 'Other' }],
      cursor: null,
      size: 2,
    }),
  }

  const page = await guardToolHandler(tool, config)({}, {})
  assert.deepEqual(
    page.data.map((board) => board.id),
    ['board-1'],
  )
})

test('only the canonical Miro HTTPS origin is accepted', () => {
  assert.equal(normalizeMiroBaseUrl(DEFAULT_MIRO_BASE_URL), DEFAULT_MIRO_BASE_URL)
  assert.equal(normalizeMiroBaseUrl('https://api.miro.com/'), DEFAULT_MIRO_BASE_URL)
  assert.equal(normalizeMiroBaseUrl('https://api.miro.com:443'), DEFAULT_MIRO_BASE_URL)

  const rejected = [
    'http://api.miro.com',
    'https://api.miro.com.evil.example',
    'https://evil.example',
    'https://api.miro.com@evil.example',
    'https://user:pass@api.miro.com',
    'https://api.miro.com/redirect',
    'https://api.miro.com:8443',
    'https://api.miro.com?debug=1',
    'https://api.miro.com#fragment',
    'ftp://api.miro.com',
    '',
    'not-a-url',
  ]
  for (const value of rejected) {
    assert.throws(
      () => normalizeMiroBaseUrl(value),
      (error) => error instanceof MiroApiError && error.code === 'invalid_base_url',
      `expected ${JSON.stringify(value)} to be rejected`,
    )
  }
})

test('a hostile MIRO_API_BASE_URL is rejected before the token is sent', () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    throw new Error('fetch must not be called')
  }
  const previous = process.env.MIRO_API_BASE_URL
  process.env.MIRO_API_BASE_URL = 'https://evil.example'
  try {
    assert.throws(
      () => createMiroClient({ accessToken: 'super-secret-token', fetchImpl }),
      (error) =>
        error instanceof MiroApiError &&
        error.code === 'invalid_base_url' &&
        !error.message.includes('super-secret-token'),
    )
    assert.equal(calls.length, 0)
  } finally {
    if (previous === undefined) delete process.env.MIRO_API_BASE_URL
    else process.env.MIRO_API_BASE_URL = previous
  }

  assert.throws(
    () =>
      createMiroClient({
        accessToken: 'super-secret-token',
        baseUrl: 'http://api.miro.com',
        fetchImpl,
      }),
    (error) => error instanceof MiroApiError && error.code === 'invalid_base_url',
  )
  assert.equal(calls.length, 0)
})

test('Miro requests do not follow redirects', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => '',
    }
  }
  const client = createMiroClient({ accessToken: 'test-token', fetchImpl })
  await client.getBoard('board-1')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(new URL(calls[0].url).origin, DEFAULT_MIRO_BASE_URL)
})

test('a blank or missing token fails closed without a request', () => {
  const previous = process.env.MIRO_ACCESS_TOKEN
  delete process.env.MIRO_ACCESS_TOKEN
  const fetchImpl = async () => {
    throw new Error('fetch must not be called')
  }
  try {
    for (const accessToken of ['', '   ', undefined]) {
      assert.throws(
        () => createMiroClient({ accessToken, fetchImpl }),
        (error) => error instanceof MiroApiError && error.code === 'missing_token',
      )
    }
  } finally {
    if (previous === undefined) delete process.env.MIRO_ACCESS_TOKEN
    else process.env.MIRO_ACCESS_TOKEN = previous
  }
})

test('the MCP SDK accepts every zod 4 tool schema', () => {
  const server = new McpServer({ name: 'schema-compat', version: '0.0.0' })
  for (const tool of tools) {
    assert.doesNotThrow(
      () =>
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
              readOnlyHint: tool.readOnly === true,
              destructiveHint: tool.destructiveHint === true || tool.destructive === true,
              openWorldHint: true,
            },
          },
          async () => ({ content: [] }),
        ),
      `the MCP SDK rejected the schema for ${tool.name}`,
    )
  }
})

test('every tool declares explicit safety metadata', () => {
  assert.equal(tools.filter((tool) => tool.readOnly === true).length, 5)
  assert.equal(tools.filter((tool) => tool.destructive === true).length, 1)
  for (const tool of tools) {
    assert.equal(typeof tool.readOnly, 'boolean', `${tool.name} must set readOnly`)
  }
  const deletion = tools.find((tool) => tool.name === 'miro_delete_item')
  assert.ok(deletion)
  assert.equal(deletion.readOnly, false)
  assert.equal(deletion.destructive, true)
  assert.equal(deletion.destructiveHint, true)

  const update = tools.find((tool) => tool.name === 'miro_update_item')
  assert.ok(update)
  assert.equal(update.destructiveHint, true)
})
