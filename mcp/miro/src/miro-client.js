/**
 * Minimal Miro REST API v2 client with retries, timeouts and typed errors.
 *
 * Docs: https://developers.miro.com/reference (REST API v2)
 */

const DEFAULT_BASE_URL = 'https://api.miro.com'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_MS = 1_000

export class MiroApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: unknown }} [meta]
   */
  constructor(message, meta = {}) {
    super(message)
    this.name = 'MiroApiError'
    this.status = meta.status
    this.code = meta.code
    this.details = meta.details
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function encodeId(value) {
  return encodeURIComponent(String(value).trim())
}

/**
 * Creates a Miro API client.
 *
 * Authentication uses a Miro access token (OAuth 2.0). The token is read from
 * `MIRO_ACCESS_TOKEN` unless passed explicitly. Never commit tokens.
 *
 * @param {{
 *   accessToken?: string,
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   maxRetries?: number,
 *   retryBaseMs?: number,
 * }} [options]
 */
export function createMiroClient(options = {}) {
  const accessToken = options.accessToken ?? process.env.MIRO_ACCESS_TOKEN
  const baseUrl = (options.baseUrl ?? process.env.MIRO_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS

  if (!accessToken) {
    throw new MiroApiError(
      'MIRO_ACCESS_TOKEN is not set. Create a Miro app, get an access token and provide it through the environment.',
      { code: 'missing_token' },
    )
  }
  if (typeof fetchImpl !== 'function') {
    throw new MiroApiError('No fetch implementation available.', { code: 'missing_fetch' })
  }

  /**
   * @param {number} ms
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, unknown>, body?: unknown }} [opts]
   * @returns {Promise<any>}
   */
  async function request(method, path, opts = {}) {
    const url = new URL(`${baseUrl}${path}`)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    let attempt = 0
    for (;;) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal,
        })
      } catch (error) {
        clearTimeout(timer)
        if (attempt >= maxRetries) {
          throw new MiroApiError(`Miro request failed: ${error.message}`, { code: 'network_error' })
        }
        await sleep(retryBaseMs * 2 ** attempt)
        attempt += 1
        continue
      }
      clearTimeout(timer)

      const text = await response.text()
      let data = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = { raw: text }
        }
      }

      if (response.ok) {
        return data
      }

      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : retryBaseMs * 2 ** attempt
        await sleep(delay)
        attempt += 1
        continue
      }

      const message =
        data?.message || data?.error || `Miro API error ${response.status}`
      throw new MiroApiError(message, {
        status: response.status,
        code: data?.code,
        details: data,
      })
    }
  }

  /**
   * @param {any} data
   */
  const toPage = (data) => ({
    data: Array.isArray(data?.data) ? data.data : [],
    cursor: data?.cursor ?? null,
    size: data?.size ?? null,
  })

  return {
    baseUrl,

    /** @param {{ limit?: number, cursor?: string, query?: string }} [opts] */
    listBoards(opts = {}) {
      return request('GET', '/v2/boards', {
        query: { limit: opts.limit, cursor: opts.cursor, query: opts.query },
      }).then(toPage)
    },

    /** @param {string} boardId */
    getBoard(boardId) {
      return request('GET', `/v2/boards/${encodeId(boardId)}`)
    },

    /** @param {{ name: string, description?: string, policy?: object }} body */
    createBoard(body) {
      return request('POST', '/v2/boards', { body })
    },

    /**
     * @param {string} boardId
     * @param {{ limit?: number, cursor?: string, type?: string }} [opts]
     */
    listItems(boardId, opts = {}) {
      return request('GET', `/v2/boards/${encodeId(boardId)}/items`, {
        query: { limit: opts.limit, cursor: opts.cursor, type: opts.type },
      }).then(toPage)
    },

    /**
     * @param {string} boardId
     * @param {string} itemId
     */
    getItem(boardId, itemId) {
      return request('GET', `/v2/boards/${encodeId(boardId)}/items/${encodeId(itemId)}`)
    },

    /**
     * @param {string} boardId
     * @param {string} itemType
     * @param {string} itemId
     * @param {object} body
     */
    updateItem(boardId, itemType, itemId, body) {
      return request(
        'PATCH',
        `/v2/boards/${encodeId(boardId)}/${encodeId(itemType)}/${encodeId(itemId)}`,
        { body },
      )
    },

    /**
     * @param {string} boardId
     * @param {string} itemType
     * @param {string} itemId
     */
    deleteItem(boardId, itemType, itemId) {
      return request(
        'DELETE',
        `/v2/boards/${encodeId(boardId)}/${encodeId(itemType)}/${encodeId(itemId)}`,
      )
    },

    /**
     * @param {string} boardId
     * @param {{ limit?: number, cursor?: string }} [opts]
     */
    listMembers(boardId, opts = {}) {
      return request('GET', `/v2/boards/${encodeId(boardId)}/members`, {
        query: { limit: opts.limit, cursor: opts.cursor },
      }).then(toPage)
    },

    /**
     * @param {string} boardId
     * @param {object} body
     */
    createStickyNote(boardId, body) {
      return request('POST', `/v2/boards/${encodeId(boardId)}/sticky_notes`, { body })
    },

    /**
     * @param {string} boardId
     * @param {object} body
     */
    createText(boardId, body) {
      return request('POST', `/v2/boards/${encodeId(boardId)}/texts`, { body })
    },

    /**
     * @param {string} boardId
     * @param {object} body
     */
    createShape(boardId, body) {
      return request('POST', `/v2/boards/${encodeId(boardId)}/shapes`, { body })
    },

    /**
     * @param {string} boardId
     * @param {object} body
     */
    createFrame(boardId, body) {
      return request('POST', `/v2/boards/${encodeId(boardId)}/frames`, { body })
    },

    /**
     * @param {string} boardId
     * @param {object} body
     */
    createConnector(boardId, body) {
      return request('POST', `/v2/boards/${encodeId(boardId)}/connectors`, { body })
    },
  }
}
