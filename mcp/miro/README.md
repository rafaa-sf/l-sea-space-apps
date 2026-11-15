# @l-sea/miro-mcp

Model Context Protocol server for the Miro REST API v2 (boards, items, sticky
notes, text, shapes, frames, connectors).

Setup, authentication, tool list and client registration are documented in
[`docs/miro.md`](../../docs/miro.md).

Quick start:

```bash
npm --prefix mcp/miro install
npm --prefix mcp/miro test

# read-only (default): only boards:read is needed
MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js
```

The access token is read from `MIRO_ACCESS_TOKEN` and must never be committed. The
repository `.env` fallback is opt-in with `MIRO_ALLOW_DOTENV=true`. Write tools need
`MIRO_ALLOW_WRITES=true`, destructive delete needs `MIRO_ALLOW_DELETE=true` as well,
and `MIRO_BOARD_IDS` restricts board-scoped calls. See [`docs/miro.md`](../../docs/miro.md).
