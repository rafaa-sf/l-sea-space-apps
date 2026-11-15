#!/usr/bin/env node
/**
 * Miro MCP server.
 *
 * Exposes the Miro REST API v2 as Model Context Protocol tools over stdio.
 * The access token is read from the MIRO_ACCESS_TOKEN environment variable.
 *
 * Safety defaults (audit SEC-03):
 * - read-only tools only; opt into writes with MIRO_ALLOW_WRITES=true;
 * - destructive delete needs a second opt-in, MIRO_ALLOW_DELETE=true;
 * - MIRO_BOARD_IDS restricts every board-scoped call to an allowlist;
 * - MIRO_API_BASE_URL must be https://api.miro.com before a token is sent;
 * - the repository `.env` fallback is opt-in via MIRO_ALLOW_DOTENV=true.
 *
 * Usage:
 *   MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js
 *
 * The process speaks MCP JSON-RPC on stdout; all diagnostics go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createMiroClient,
  DEFAULT_MIRO_BASE_URL,
  normalizeMiroBaseUrl,
} from './miro-client.js'
import { guardToolHandler, resolveConfig, selectTools } from './config.js'
import { tools } from './tools.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Local-development fallback: read MIRO_ACCESS_TOKEN from the repository root
 * `.env` when the MCP client did not provide it in the child environment.
 * This is off by default; set MIRO_ALLOW_DOTENV=true to opt in. The `.env`
 * file is gitignored and never committed.
 */
function loadRepoEnvToken() {
  if (process.env.MIRO_ACCESS_TOKEN) return
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const envPath = resolve(here, '../../../.env')
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^MIRO_ACCESS_TOKEN=(.*)$/)
      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, '')
        if (value) process.env.MIRO_ACCESS_TOKEN = value
        break
      }
    }
  } catch {
    /* no .env file: rely on the MCP client environment */
  }
}

// Fail closed before the server accepts calls if the token destination is not
// the Miro HTTPS API. This check does not need (and never logs) the token.
try {
  normalizeMiroBaseUrl(process.env.MIRO_API_BASE_URL ?? DEFAULT_MIRO_BASE_URL)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[miro-mcp] refusing to start: ${message}`)
  process.exit(1)
}

const SERVER_NAME = 'miro'
const SERVER_VERSION = '0.1.0'

const config = resolveConfig(process.env)
if (config.allowDotenv) loadRepoEnvToken()

const enabledTools = selectTools(tools, config)

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

/** @type {ReturnType<typeof createMiroClient> | null} */
let client = null

function getClient() {
  if (!client) client = createMiroClient()
  return client
}

/**
 * @param {unknown} value
 */
function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

/**
 * @param {unknown} error
 */
function errorResult(error) {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text', text: `${name}: ${message}` }],
  }
}

for (const tool of enabledTools) {
  const handler = guardToolHandler(tool, config)
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
    /**
     * @param {Record<string, any>} args
     */
    async (args) => {
      try {
        return textResult(await handler(getClient(), args))
      } catch (error) {
        return errorResult(error)
      }
    },
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)

const mode = config.allowWrites ? 'writes enabled' : 'read-only'
const allowlist =
  config.boardIds.size > 0 ? `, ${config.boardIds.size} allowlisted board(s)` : ''
console.error(
  `[miro-mcp] ${SERVER_NAME} v${SERVER_VERSION} ready on stdio ` +
    `(${enabledTools.length}/${tools.length} tools, ${mode}${allowlist})`,
)
if (config.allowDelete) {
  console.error(
    '[miro-mcp] WARNING: miro_delete_item is enabled (MIRO_ALLOW_DELETE=true); destructive calls are not confirmed by the server.',
  )
} else if (config.allowWrites) {
  console.error(
    '[miro-mcp] write tools enabled; miro_delete_item stays disabled (set MIRO_ALLOW_DELETE=true to enable it).',
  )
}
if (config.allowWrites && config.boardIds.size === 0) {
  console.error(
    '[miro-mcp] WARNING: write tools enabled without MIRO_BOARD_IDS; every board the token can reach is writable.',
  )
}
if (!process.env.MIRO_ACCESS_TOKEN) {
  console.error(
    '[miro-mcp] MIRO_ACCESS_TOKEN is not set; tool calls will fail until it is provided.',
  )
}
