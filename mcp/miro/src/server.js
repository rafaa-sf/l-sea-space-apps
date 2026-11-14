#!/usr/bin/env node
/**
 * Miro MCP server.
 *
 * Exposes the Miro REST API v2 as Model Context Protocol tools over stdio.
 * The access token is read from the MIRO_ACCESS_TOKEN environment variable.
 *
 * Usage:
 *   MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js
 *
 * The process speaks MCP JSON-RPC on stdout; all diagnostics go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMiroClient } from './miro-client.js'
import { tools } from './tools.js'

const SERVER_NAME = 'miro'
const SERVER_VERSION = '0.1.0'

const READ_ONLY_TOOLS = new Set([
  'miro_list_boards',
  'miro_get_board',
  'miro_list_items',
  'miro_get_item',
  'miro_list_members',
])

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

for (const tool of tools) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: READ_ONLY_TOOLS.has(tool.name)
        ? { readOnlyHint: true, openWorldHint: true }
        : { readOnlyHint: false, openWorldHint: true },
    },
    /**
     * @param {Record<string, any>} args
     */
    async (args) => {
      try {
        return textResult(await tool.handler(getClient(), args))
      } catch (error) {
        return errorResult(error)
      }
    },
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[miro-mcp] ${SERVER_NAME} v${SERVER_VERSION} ready on stdio (${tools.length} tools)`)
