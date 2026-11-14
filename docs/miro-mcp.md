# Miro MCP server

A small [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes the **Miro** REST API v2 to AI agents, so they can read and build Miro
boards (sticky notes, text, shapes, frames, connectors) during the hackathon.

The team uses Miro as a collaboration platform; this server lets an agent work
on the same boards as the humans.

## Layout

```text
mcp/miro/
├── package.json
├── README.md
├── src/
│   ├── server.js        # MCP stdio server, registers the tools
│   ├── miro-client.js   # Miro REST API v2 client (retries, timeouts, errors)
│   └── tools.js         # tool definitions and payload builders
└── test/
    └── miro-client.test.js
```

## Authentication

The server authenticates with a **Miro access token** read from the
`MIRO_ACCESS_TOKEN` environment variable.

1. Create a Miro app at <https://miro.com/app/settings/user-profile/apps>.
2. Request the scopes you need: `boards:read` (read-only tools) and
   `boards:write` (tools that create, update or delete items).
3. Install the app on a team and get an access token.
4. Store the token locally only — never commit it:

```bash
cp .env.example .env   # if not present yet
# edit .env and set MIRO_ACCESS_TOKEN=...
```

`.env` is ignored by git. The token is passed to the server through the MCP
client configuration, not written anywhere in the repository.

## Run

```bash
# from the repository root
npm --prefix mcp/miro start

# or explicitly
MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js
```

The process speaks MCP JSON-RPC over **stdout**; diagnostics go to **stderr**.

## Test

```bash
npm --prefix mcp/miro test
```

The suite uses mocked HTTP responses and does not need a token or network access.

## Tools

| Tool | Purpose | Scope |
| --- | --- | --- |
| `miro_list_boards` | List accessible boards (paginated) | boards:read |
| `miro_get_board` | Board metadata | boards:read |
| `miro_create_board` | Create a board | boards:write |
| `miro_list_items` | List board items, optional type filter | boards:read |
| `miro_get_item` | Get one item | boards:read |
| `miro_create_sticky_note` | Create a sticky note (content, color, position, frame) | boards:write |
| `miro_create_text` | Create a text item | boards:write |
| `miro_create_shape` | Create a shape with optional text | boards:write |
| `miro_create_frame` | Create a frame container | boards:write |
| `miro_create_connector` | Connect two items | boards:write |
| `miro_update_item` | Update data/style/position of an item | boards:write |
| `miro_delete_item` | Delete an item | boards:write |
| `miro_list_members` | List board members | boards:read |

## Register with an MCP client

### DeepSeek Harness (this project's agent team)

Add an entry to the profile patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`), then restart the harness:

```yaml
- id: mcp-miro
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: miro
    transport: stdio
    command: node
    args: ['mcp/miro/src/server.js']
    cwd: /home/event/L-SEA
    env:
      MIRO_ACCESS_TOKEN: !!js process.env.MIRO_ACCESS_TOKEN
```

The tools then appear to the model as `mcp__miro__<tool>`
(e.g. `mcp__miro__miro_create_sticky_note`).

### Claude Desktop / other MCP clients

```json
{
  "mcpServers": {
    "miro": {
      "command": "node",
      "args": ["/home/event/L-SEA/mcp/miro/src/server.js"],
      "env": {
        "MIRO_ACCESS_TOKEN": "<token>"
      }
    }
  }
}
```

## Limitations

- The server uses a single access token from the environment; OAuth refresh flows
  are not implemented yet. If the token expires, provide a fresh one.
- Miro rate limits are handled with retries only for `429`/`5xx` responses (up to
  three attempts, honouring `Retry-After`).
- `miro_update_item` and `miro_delete_item` require the correct `itemType`
  (e.g. `sticky_note`, `text`, `shape`, `frame`) because Miro exposes
  type-specific endpoints.
- The server is a local stdio process; it does not host an HTTP endpoint.

## Attribution

Miro REST API v2: <https://developers.miro.com/reference>. Miro is a third-party
collaboration platform and is not affiliated with NASA.
