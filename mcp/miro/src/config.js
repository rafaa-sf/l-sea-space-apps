/**
 * Runtime safety configuration for the Miro MCP server (audit SEC-03).
 *
 * Defaults are deliberately conservative:
 * - the server registers read-only tools only;
 * - destructive tools need both write and delete opt-ins;
 * - board-scoped calls can be restricted with `MIRO_BOARD_IDS`;
 * - the `.env` token fallback is opt-in.
 *
 * Environment:
 * - `MIRO_ALLOW_WRITES=true` enables create/update tools.
 * - `MIRO_ALLOW_DELETE=true` (with writes) enables `miro_delete_item`.
 * - `MIRO_BOARD_IDS=id1,id2` restricts board-scoped calls to that allowlist.
 * - `MIRO_ALLOW_DOTENV=true` allows reading the token from the repo `.env`.
 */

/** Thrown when a request violates the server safety configuration. */
export class MiroConfigError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'MiroConfigError'
    this.code = 'config_error'
  }
}

/**
 * Parse a boolean opt-in environment value. Only the documented affirmative
 * spellings enable a gate; everything else stays disabled.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEnabled(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Parse `MIRO_BOARD_IDS` (comma/whitespace separated) into a set.
 *
 * @param {unknown} value
 * @returns {Set<string>}
 */
export function parseBoardIds(value) {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

/**
 * Resolve the safety flags from an environment object.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *   allowWrites: boolean,
 *   allowDelete: boolean,
 *   allowDotenv: boolean,
 *   boardIds: Set<string>,
 * }}
 */
export function resolveConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {}
  const allowWrites = isEnabled(source.MIRO_ALLOW_WRITES)
  return {
    allowWrites,
    // Delete is a destructive operation: it needs its own opt-in and writes.
    allowDelete: allowWrites && isEnabled(source.MIRO_ALLOW_DELETE),
    allowDotenv: isEnabled(source.MIRO_ALLOW_DOTENV),
    boardIds: parseBoardIds(source.MIRO_BOARD_IDS),
  }
}

/**
 * Select the tools that may be registered for a configuration.
 *
 * @param {Array<{ name: string, readOnly?: boolean, destructive?: boolean }>} allTools
 * @param {ReturnType<typeof resolveConfig>} config
 * @returns {Array<{ name: string, readOnly?: boolean, destructive?: boolean }>}
 */
export function selectTools(allTools, config) {
  return allTools.filter((tool) => {
    if (!tool.readOnly && !config.allowWrites) return false
    if (tool.destructive && !config.allowDelete) return false
    // A newly created board cannot be in the allowlist, so creating one would
    // escape it. Disable the tool whenever an allowlist is active.
    if (config.boardIds.size > 0 && tool.name === 'miro_create_board') return false
    return true
  })
}

/**
 * Enforce the board allowlist for one board id.
 *
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {unknown} boardId
 * @returns {string} The trimmed board id.
 * @throws {MiroConfigError} When an allowlist is active and the id is missing
 *   or not listed.
 */
export function assertBoardAllowed(config, boardId) {
  const id = typeof boardId === 'string' ? boardId.trim() : ''
  if (config.boardIds.size === 0) return id
  if (!id) {
    throw new MiroConfigError('A boardId is required and must be listed in MIRO_BOARD_IDS.')
  }
  if (!config.boardIds.has(id)) {
    throw new MiroConfigError(`Board '${id}' is not listed in MIRO_BOARD_IDS.`)
  }
  return id
}

/**
 * Keep only allowlisted boards in a `listBoards` page.
 *
 * @param {any} result
 * @param {Set<string>} boardIds
 * @returns {any}
 */
function filterBoardsPage(result, boardIds) {
  if (!result || !Array.isArray(result.data)) return result
  return {
    ...result,
    data: result.data.filter((board) => boardIds.has(String(board?.id ?? '').trim())),
  }
}

/**
 * Wrap a tool handler with the board allowlist and board-list filtering.
 *
 * The wrapper is defense in depth on top of {@link selectTools}: even if a
 * handler is invoked directly with an unlisted board id, the call is refused
 * before it reaches the Miro client.
 *
 * @param {{ name: string, handler: (client: any, args: any) => any }} tool
 * @param {ReturnType<typeof resolveConfig>} config
 * @returns {(client: any, args?: any) => Promise<any>}
 */
export function guardToolHandler(tool, config) {
  return async (client, args = {}) => {
    if (config.boardIds.size > 0 && tool.name === 'miro_create_board') {
      throw new MiroConfigError(
        'miro_create_board is disabled while MIRO_BOARD_IDS is set.',
      )
    }
    if (config.boardIds.size > 0 && tool.name !== 'miro_list_boards') {
      // Every other currently registered tool is board-scoped. A future tool
      // without a boardId is blocked by default, which is the safe failure.
      assertBoardAllowed(config, args?.boardId)
    } else if (args && args.boardId !== undefined) {
      assertBoardAllowed(config, args.boardId)
    }
    const result = await tool.handler(client, args)
    if (tool.name === 'miro_list_boards' && config.boardIds.size > 0) {
      return filterBoardsPage(result, config.boardIds)
    }
    return result
  }
}
