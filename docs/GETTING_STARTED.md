# Connect your agents

SimpleAgentStore is a SQLite-backed, single-user object store. PostgreSQL is not implemented. All clients must point to the same server/database for cross-agent retrieval.

Upgrading an existing AgentStore installation? Read [the compatibility and plugin transition notes](UPGRADING.md) before installing a second connection.

## Recommended: Docker and a bundled plugin

From the cloned repository:

```bash
docker compose up --build -d --wait
```

This starts MCP at `http://127.0.0.1:4311/mcp` and the dashboard at `http://127.0.0.1:4310`. Both use the same persistent Docker volume; no database credentials or local Node installation are needed. See [Docker setup](DOCKER.md) for storage, backups, ports, and stopping safely.

Then install **one** bundled plugin per client using the commands below. The plugin includes the local MCP connection **and** the routing skill. Do not also register a manual connection to the same server: duplicate tool sets can confuse selection.

### Codex plugin

Run from the repository root:

```bash
codex plugin marketplace add "$PWD"
codex plugin add simpleagentstore@personal
```

The repository's existing Codex marketplace is named `personal`. If a different marketplace with that name is already registered, use the app's plugin installer to select this repository's source explicitly instead of replacing your existing marketplace. Restart/open a new conversation after installation and enable the plugin. The included portable `mcp.json` and legacy `.mcp.json` cover the current and compatibility manifest layouts.

### Claude Code plugin

```bash
claude plugin marketplace add "$PWD"
claude plugin install simpleagentstore@agentstore-local --scope user
```

Restart/open a new conversation and enable the plugin. For a session-only development install:

```bash
claude --plugin-dir "$PWD/plugins/simpleagentstore"
```

Both plugins target the default local endpoint without a bearer token. They do not start the server, install themselves into other clients, bypass approvals, or guarantee model tool selection.

## Native Node.js alternative

Requires Node.js 22+. Run `npm ci`. The dashboard and MCP adapter share `data/agentstore.sqlite` by default. Optionally copy `.env.example` to `.env` and set `AGENTSTORE_DB_PATH` to a persistent SQLite file. Native npm commands load `.env`, then `.env.local`; exported environment variables win. Keep the configured path the same for both adapters. Docker data and native data are separate unless explicitly migrated.

Run `npm run mcp:http` and `npm run dashboard` in separate terminals. The bundled plugins work with native HTTP too.

## Local HTTP connection

For clients without plugins, or if you prefer manual MCP registration, start the native HTTP server (or use the running Compose service):

```bash
npm run mcp:http
```

The endpoint is `http://127.0.0.1:4311/mcp`. Keep this process running. Local HTTP clients must run on the same machine.

### Claude Code

```bash
claude mcp add --transport http --scope user simpleagentstore http://127.0.0.1:4311/mcp
```

### Codex

```bash
codex mcp add simpleagentstore --url http://127.0.0.1:4311/mcp
codex mcp list
```

Restart the Codex app or CLI session after registering the server.

## Stdio alternative

Run these commands from the repository root. The client launches the MCP process, so a separate HTTP server is not required.

### Claude Code

```bash
claude mcp add --scope user simpleagentstore \
  --env AGENTSTORE_DB_PATH="$PWD/data/agentstore.sqlite" \
  -- npm --silent --prefix "$PWD" run mcp
```

### Codex

```bash
codex mcp add simpleagentstore \
  --env AGENTSTORE_DB_PATH="$PWD/data/agentstore.sqlite" \
  -- npm --silent --prefix "$PWD" run mcp
```

Choose one transport for a server named `simpleagentstore`; don't register both under the same name.

## Custom endpoint or bearer token

If you change the port, enable authentication, or use HTTPS, register the connection explicitly instead of enabling the bundled default connection. Do not put real tokens in tracked plugin files. A plugin's fixed URL is not automatically changed by `.env`.

For Codex, export `AGENTSTORE_MCP_TOKEN` in the environment that **launches Codex**, then register:

```bash
codex mcp add simpleagentstore --url http://127.0.0.1:4311/mcp \
  --bearer-token-env-var AGENTSTORE_MCP_TOKEN
```

Replace the URL as needed. A server-side `.env` does not export secrets into an already-running Codex app. Use [integrations/codex.toml](../integrations/codex.toml) as a mergeable template, not a replacement for your full config.

For Claude Code, merge this server entry into a private MCP configuration. Claude resolves the variable from its launch environment:

```json
{
  "mcpServers": {
    "simpleagentstore": {
      "type": "http",
      "url": "http://127.0.0.1:4311/mcp",
      "headers": { "Authorization": "Bearer ${AGENTSTORE_MCP_TOKEN}" }
    }
  }
}
```

Use the same token on the server. For a token-free custom port, simply change the URL and omit headers. For a locally customized plugin, change the URLs in **both** `plugins/simpleagentstore/mcp.json` and `plugins/simpleagentstore/.mcp.json` before installing; reinstall/update the plugin after source changes because installed plugins may be cached.

The routing skill is also independently distributable from [plugins/simpleagentstore/skills/simpleagentstore-routing](../plugins/simpleagentstore/skills/simpleagentstore-routing). To use it alongside a manual connection without bundling a second MCP connection, copy that directory into the client's supported skills directory (`~/.agents/skills/` for Codex or `~/.claude/skills/` for Claude Code). Check for an existing copy before replacing it.

## Other MCP clients

- [integrations/mcp.json](../integrations/mcp.json): Claude Code/compatible `mcpServers` configuration. Merge it into the client's settings rather than overwriting existing servers.
- [integrations/vscode.mcp.json](../integrations/vscode.mcp.json): merge into `.vscode/mcp.json` for VS Code/Copilot, then trust and enable the server.
- Any Streamable HTTP MCP client: add `http://127.0.0.1:4311/mcp`; no product-specific server fork is needed.

Clients that only support stdio can use the alternative above with an **absolute** SQLite path. HTTP is recommended when multiple agents should share the same running store. Browser/cloud-hosted clients cannot reach your machine's localhost; they require a reachable HTTPS endpoint and a supported authentication mechanism. This source package does not provision that or implement OAuth.

## Verify save and retrieval

1. In one connected agent: “Save this to my notes: the orchid launch checklist is ready.”
2. Confirm that `store_object` succeeded and the object appears in the dashboard.
3. In another connected agent: “Find my note about the orchid launch checklist.”
4. Inspect the actual `search_objects` followed by `get_object` calls and returned value.
5. Ask “Show me all my notes” and verify pagination if there are more than one page.

The routing skill reinforces explicit saves, search-then-get, exact cursor continuation, count-only queries, and lexical fallbacks. Only treat information as saved after a successful tool response. Nothing is silently persisted just because the agent says it will remember.

## Dashboard

In a separate terminal, from the repository root:

```bash
npm run dashboard
```

Open `http://127.0.0.1:4310`. Browse metrics and objects, filter and search, inspect full JSON, and create, update, or delete objects. The dashboard is a local adapter over the same core store.

## Development HTTPS tunnel

Configure your own Cloudflare tunnel and HTTPS hostname pointing to `/mcp`. Set these in the gitignored `.env.local` for the native workflow (or explicitly use `--env-file .env.local` for Compose):

```dotenv
AGENTSTORE_MCP_TOKEN=replace-with-a-long-random-token
AGENTSTORE_TUNNEL_ID=replace-with-your-cloudflare-tunnel-id
```

Run these as separate processes:

```bash
npm run mcp:http
```

```bash
npm run mcp:tunnel
```

Configure each client to use your HTTPS URL and send the same token in an `Authorization: Bearer ...` header. A token is mandatory before exposing the endpoint through a public tunnel. `/health` remains unauthenticated for monitoring.

The helper rewrites the upstream Host header to `localhost`, which the server validates. Do not forward the dashboard. Clients must support the chosen authentication mechanism; an HTTPS URL alone is not sufficient.

This is development infrastructure, not a public managed service. See [OSS_READINESS.md](../OSS_READINESS.md) for production authorization, isolation, and operational requirements. Never commit or distribute `.env.local`.

## Tools and pagination

| Core operation | MCP tool |
| --- | --- |
| `put` | `store_object` |
| `get` | `get_object` |
| `list` | `list_objects` |
| `search` | `search_objects` |
| `delete` | `delete_object` |

`search_objects` returns lightweight candidates without full values. Select a key and call `get_object` for the full payload.

`list_objects` returns `results`, page `count`, `total_count`, and `next_cursor`. For complete lists, pass the exact returned cursor until it is null. For count-only questions, request one row and read `total_count`.

## Seed experiment and verification

```bash
npm run seed
```

This recreates the separate `data/demo.sqlite`, inserts example objects, and prints lexical and structured retrieval results. It does not seed the dashboard's default database. The examples deliberately include vocabulary mismatches to expose lexical search limits.

```bash
npm run check
npm test
npm run build
npm audit
npm run test:docker
```

The neutral comparison harness is maintained separately in the sibling `agentstore-bench` workspace; it is not bundled in this repository. Its reports include source hashes, per-query rankings, local latency, scale behavior, and individual capability checks.

## Client format references

The packaging follows the official [OpenAI plugin format](https://developers.openai.com/plugins/build/plugins), [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference), and [VS Code MCP configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers). Installing locally is not publication or approval in a vendor marketplace.

← [Back to the README](../README.md)
