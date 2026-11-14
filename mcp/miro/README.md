# @l-sea/miro-mcp

Model Context Protocol server for the Miro REST API v2 (boards, items, sticky
notes, text, shapes, frames, connectors).

Setup, authentication, tool list and client registration are documented in
[`docs/miro.md`](../../docs/miro.md).

Quick start:

```bash
npm --prefix mcp/miro install
npm --prefix mcp/miro test
MIRO_ACCESS_TOKEN='<token>' node mcp/miro/src/server.js
```

The access token is read from `MIRO_ACCESS_TOKEN` and must never be committed.
