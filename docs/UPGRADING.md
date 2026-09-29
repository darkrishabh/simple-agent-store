# Upgrading from AgentStore

The project is now **SimpleAgentStore**, at [darkrishabh/simple-agent-store](https://github.com/darkrishabh/simple-agent-store). Version 0.3.0 prepares the renamed local, single-user alpha. The rename itself does not migrate, copy, or delete stored objects.

## Existing checkout

Keep your current directory; renaming it is optional. Update the remote using the transport you already use:

```bash
git remote set-url origin https://github.com/darkrishabh/simple-agent-store.git
# For an existing SSH remote instead:
# git remote set-url origin git@github.com:darkrishabh/simple-agent-store.git
```

Back up first, review local changes, and follow your normal Git update workflow. Never reset local changes just to update. GitHub redirects the previous repository URL, but use the new URL for integrations and fresh clones.

## What intentionally stays compatible

| Interface | Unchanged |
| --- | --- |
| Native storage | `data/agentstore.sqlite`, or the existing `AGENTSTORE_DB_PATH` |
| Environment | All `AGENTSTORE_*` variables; there is no new required prefix |
| Docker storage | Default project `agentstore`, volume `agentstore_agentstore-data`, file `/data/agentstore.sqlite` |
| Endpoints | Dashboard port 4310; MCP port 4311 at `/mcp` |
| Tools | `store_object`, `get_object`, `list_objects`, `search_objects`, `delete_object` |
| Core API | `AgentStore` class, object keys, IDs, versions, metadata and stored values |
| Marketplace IDs | Codex `personal`; Claude `agentstore-local` |

These legacy identifiers are compatibility contracts, not incomplete branding.

### Native installations

Stop your existing dashboard and MCP processes, take a [verified backup](DATABASE_OPERATIONS.md), update, run `npm ci`, and restart using the same configuration. If you move the checkout, preserve `.env`, `.env.local`, the database and its sidecars; update absolute stdio launch paths in your clients. A fresh clone has a fresh native database unless you point it to your existing one.

### Docker installations

The Compose file now explicitly pins the original default project name, so cloning or renaming the folder to `simple-agent-store` does not silently create a new empty volume.

If you previously used a custom directory-derived project name, `-p`, or `COMPOSE_PROJECT_NAME`, **continue supplying that exact project name**. Inspect `docker compose ls` and `docker volume ls` before starting; do not guess. For example, an existing project named `my-store` must still use `docker compose -p my-store ...`.

Back up using [Docker operations](DOCKER.md), then run `docker compose up --build -d --wait` with your existing project override, if any. Do not run `down --volumes`. Native and Docker data remain separate.

## Client/plugin transition

Existing manual MCP registrations named `agentstore` continue working: the endpoint and tool names have not changed. You do not need to rename a working registration.

New plugin installs use `simpleagentstore`; the bundled skill is `simpleagentstore-routing`. Refresh your repository marketplace source, disable the old `agentstore` plugin or duplicate manual registration, then follow [the installation guide](GETTING_STARTED.md). Copy any custom URL/token configuration privately; never commit it. Open a new conversation and verify a save and retrieval before removing the old configuration. Installing the renamed plugin does not upgrade an already-installed old plugin automatically.

The MCP handshake now reports `simpleagentstore` and the package version. Clients with cached metadata may need a restart. The routing skill helps agents choose tools; it is not a guarantee of automatic saving.

## Release boundary

This is still a SQLite-only local alpha. The registered domain does not provide a hosted MCP endpoint, account system, OAuth, or managed backups. Do not point clients to the domain expecting a server to exist there.
