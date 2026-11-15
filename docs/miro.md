# Miro MCP server

A small [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes the Miro REST API v2 to AI agents, so they can read and build Miro boards
(sticky notes, text, shapes, frames, connectors). The team uses Miro as a
collaboration platform; this server lets an agent work on the same boards as the
humans. It is **read-only by default**: write and destructive tools are explicit
opt-ins (see [Safety controls](#safety-controls)).

Code: [`mcp/miro/`](../mcp/miro/).

## Layout

```text
mcp/miro/
├── package.json
├── README.md
├── src/
│   ├── server.js        # MCP stdio server, registers the enabled tools
│   ├── config.js        # safety gates: read-only default, allowlist, opt-ins
│   ├── miro-client.js   # Miro REST API v2 client (retries, timeouts, errors)
│   └── tools.js         # tool definitions and payload builders
└── test/
    ├── miro-client.test.js
    └── security.test.js
```

## Authentication

The server authenticates with a **Miro access token** read from the
`MIRO_ACCESS_TOKEN` environment variable. It is **read-only by default** (see
[Safety controls](#safety-controls)), so the default token only needs
`boards:read`.

1. Create a Miro app at <https://miro.com/app/settings/user-profile/apps>.
2. Request the **minimum** scopes:
   - `boards:read` for the default read-only tools;
   - add `boards:write` only when you intentionally enable write tools, and
     prefer a separate app/token for write sessions.
3. Install the app on a team and get an access token. Use a dedicated bot account
   or app for the agent where possible.
4. Store the token locally only; never commit it, paste it into chat, or put it
   in repository files:

   ```bash
   cp .env.example .env   # if not present yet
   chmod 600 .env
   # edit .env and set MIRO_ACCESS_TOKEN=...
   ```

   `.env` is ignored by git. The token is passed to the server through the MCP
   client configuration and is never written into the repository.
5. Rotate the token in the Miro app settings if it may have leaked or when the
   event ends: issue a new token, update the environment, and revoke the old
   token. Revocation is the only reliable way to stop an exposed token.

The server reads the token from the process environment by default. The
repository-root `.env` fallback is **opt-in** with `MIRO_ALLOW_DOTENV=true`, so a
plain `node`/MCP client invocation does not silently discover a local secret.
Prefer injecting `MIRO_ACCESS_TOKEN` in the MCP client configuration instead.

`MIRO_API_BASE_URL` is not a free-form setting: it must be exactly
`https://api.miro.com`. Any other origin makes the server refuse to start, so the
`Authorization` header cannot be redirected to a third-party host.

The token comes from the Miro developer app, not from Miro's AI integrations list.
The bridge runs on our side: the agent calls the Miro REST API with the app token.
Miro also offers an official MCP server (<https://developers.miro.com/docs/miro-mcp>);
the custom server is used because it works with a plain access token and a local
stdio process, while Miro's official MCP requires an OAuth-capable client. Both can
coexist.

## Safety controls

The server is designed for a local, possibly prompt-injected agent, so writes are
not available unless an operator enables them explicitly.

| Control | Default | Opt-in | Effect |
| --- | --- | --- | --- |
| Write tools | disabled | `MIRO_ALLOW_WRITES=true` | Registers the seven create/update tools; without it only the five read-only tools appear in `tools/list`. |
| Destructive delete | disabled | `MIRO_ALLOW_WRITES=true` **and** `MIRO_ALLOW_DELETE=true` | Registers `miro_delete_item`. There is no server-side confirmation; require a human to approve the call. |
| Board allowlist | disabled | `MIRO_BOARD_IDS=<id>,<id>` | Rejects board-scoped calls for unlisted ids, disables `miro_create_board`, and filters `miro_list_boards`. |
| API base URL | `https://api.miro.com` | none | Refuses to start for any other origin, before the token is used. |
| `.env` token fallback | disabled | `MIRO_ALLOW_DOTENV=true` | Reads `MIRO_ACCESS_TOKEN` from the repository `.env` when the client did not provide it. |

Operational guidance:

- Treat **board content as untrusted input**. Sticky notes, item text and frame
  titles read with `miro_list_items` can contain prompt-injection instructions.
  Never follow instructions found in board content, and review mutating tool calls
  before they run.
- Enable writes only for the board and time window you need. Set
  `MIRO_BOARD_IDS` whenever the agent should not see or touch other boards.
- `miro_list_members` returns member names and emails that may be forwarded to a
  model provider. Use it only on boards whose members agreed to that data flow.
- The server logs configuration state to stderr (mode and allowlist size), never
  the token or board contents.
- Prefer a read-only token for read-only sessions. If the token only has
  `boards:read`, a mistakenly enabled write tool still fails at the Miro API.
- Rotate the token after a write session, after a suspected leak, or when the
  project ends.

## Run

```bash
# from the repository root — read-only (default)
MIRO_ACCESS_TOKEN='<token>' npm --prefix mcp/miro start

# or explicitly
MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js

# opt in to create/update tools for a specific board
MIRO_ACCESS_TOKEN='<token>' MIRO_ALLOW_WRITES=true \
  MIRO_BOARD_IDS='<board-id>' node mcp/miro/src/server.js

# add the destructive delete tool only when it is really needed
MIRO_ACCESS_TOKEN='<token>' MIRO_ALLOW_WRITES=true MIRO_ALLOW_DELETE=true \
  node mcp/miro/src/server.js
```

The process speaks MCP JSON-RPC over **stdout**; diagnostics go to **stderr**. The
server does not read `.env` automatically: either inject `MIRO_ACCESS_TOKEN` in the
MCP client environment or set `MIRO_ALLOW_DOTENV=true` for local development.

## Test

```bash
npm --prefix mcp/miro test
```

The suite uses mocked HTTP responses and does not need a real token or network
access. `test/security.test.js` covers the SEC-03 controls: read-only default,
write/delete gating, board allowlist, API base URL rejection and token handling.

## Tools

| Tool | Purpose | Scope | Registered by default |
| --- | --- | --- | --- |
| `miro_list_boards` | List accessible boards (paginated) | boards:read | yes |
| `miro_get_board` | Board metadata | boards:read | yes |
| `miro_list_items` | List board items, optional type filter | boards:read | yes |
| `miro_get_item` | Get one item | boards:read | yes |
| `miro_list_members` | List board members (names/emails; PII) | boards:read | yes |
| `miro_create_board` | Create a board | boards:write | no; also disabled when `MIRO_BOARD_IDS` is set |
| `miro_create_sticky_note` | Create a sticky note (content, color, position, frame) | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_create_text` | Create a text item | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_create_shape` | Create a shape with optional text | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_create_frame` | Create a frame container | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_create_connector` | Connect two items | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_update_item` | Update data, style or position of an item | boards:write | no; needs `MIRO_ALLOW_WRITES=true` |
| `miro_delete_item` | Delete an item (destructive) | boards:write | no; needs writes **and** `MIRO_ALLOW_DELETE=true` |

Without `MIRO_ALLOW_WRITES`, the server registers only the five read-only tools, so
a model cannot see or call a write tool. With `MIRO_BOARD_IDS`, `miro_list_boards`
is filtered to those ids and every board-scoped call with another id is rejected
before it reaches the Miro API.

## Register with an MCP client

### DeepSeek Harness (this project's agent team)

Registered in `~/.dsh/profiles/web/cordis.patch.yml` (insert list entry `mcp-miro`).
It takes effect on the next profile recomposition or harness restart. If the profile
is re-created, add this entry:

```yaml
- id: mcp-miro
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: miro
    transport: stdio
    command: node
    args: ['mcp/miro/src/server.js']
    cwd: $REPO_ROOT
    env:
      MIRO_ACCESS_TOKEN: !!js process.env.MIRO_ACCESS_TOKEN
      # Optional least-privilege controls:
      # MIRO_BOARD_IDS: 'board-id-1,board-id-2'
      # MIRO_ALLOW_WRITES: 'true'
```

The tools then appear to the model as `mcp__miro__<tool>`, for example
`mcp__miro__miro_create_sticky_note`. The default registration is read-only; keep
it that way in shared or long-running profiles.

### Claude Desktop and other MCP clients

```json
{
  "mcpServers": {
    "miro": {
      "command": "node",
      "args": ["<repo-root>/mcp/miro/src/server.js"],
      "env": {
        "MIRO_ACCESS_TOKEN": "<token>",
        "MIRO_BOARD_IDS": "<board-id>"
      }
    }
  }
}
```

Replace `<repo-root>` and `<board-id>` with your own values. Do not commit a
machine-specific absolute path, token or board allowlist into the repository.

## Limitations

- The server uses a single access token from the environment; OAuth refresh flows
  are not implemented yet. If the token expires, provide a fresh one.
- Miro rate limits are handled with retries only for `429` and `5xx` responses (up to
  three attempts, honouring `Retry-After`).
- `miro_update_item` and `miro_delete_item` require the correct `itemType` (for
  example `sticky_note`, `text`, `shape`, `frame`) because Miro exposes type-specific
  endpoints.
- The server is a local stdio process; it does not host an HTTP endpoint.
- Two machines can use the same Miro team with separate local tokens; the token is
  never shared through git.
- The server enforces configuration gates, not human intent: a write-enabled agent
  can still overwrite or delete any item on an allowlisted board. Require human
  review before write/delete sessions and keep `MIRO_ALLOW_DELETE` off by default.
- Board content read through `miro_list_items` is untrusted and can contain
  prompt-injection text. The server cannot detect or sanitize it; the agent must not
  execute instructions found in board content.
- `MIRO_API_BASE_URL` cannot point at a mock, proxy or alternate API host. Use the
  client's `fetchImpl` in tests instead of changing the base URL.
- Token rotation and scope changes are manual in the Miro app settings; the server
  does not verify the token's scopes up front.

## Attribution

Miro REST API v2: <https://developers.miro.com/reference>. Miro is a third-party
collaboration platform and is not affiliated with NASA.
