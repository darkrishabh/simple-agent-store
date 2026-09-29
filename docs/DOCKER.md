# Docker setup

## Start

From a clone of this repository, with Docker and Compose v2 running:

```bash
docker compose up --build -d --wait
```

- Dashboard: `http://127.0.0.1:4310`
- MCP Streamable HTTP: `http://127.0.0.1:4311/mcp`
- MCP liveness check: `http://127.0.0.1:4311/health`

Connect all agents to that same endpoint. The [bundled plugins](GETTING_STARTED.md) include both the default MCP connection and save/retrieval instructions. They do not start Docker for you.

## Storage

SQLite is the only implemented backend. There is no Postgres service or database password to configure. Both containers use `/data/agentstore.sqlite` in the Compose-managed `agentstore-data` named volume. The Docker image does **not** include local databases, environment files, or tokens.

The image runs as the unprivileged `node` user (UID 1000), with a read-only root filesystem; only the data volume is writable. SQLite WAL files live next to the database in that volume. The dashboard waits for MCP to initialize the database before starting.

This volume is separate from a native checkout's `data/agentstore.sqlite`. Switching from native Node to Docker does not automatically import existing notes. The default Compose project is explicitly pinned to `agentstore`, preserving the `agentstore_agentstore-data` volume across the repository rename. If you previously used a custom project name (including one derived from a custom checkout folder), keep that exact name with `-p` or `COMPOSE_PROJECT_NAME`. See [the upgrade guide](UPGRADING.md).

### Existing database or host directory

Prefer the named volume for a new installation. To use an existing directory, create a local Compose override that replaces the `/data` mount on **both** services:

```yaml
services:
  mcp:
    volumes:
      - ./data:/data
  dashboard:
    volumes:
      - ./data:/data
```

Save this as `compose.override.yaml` (gitignored). Stop native processes first and take a verified backup. The directory must be writable by UID 1000 inside the container; bind-mount ownership varies by platform. Use a local disk, not a network filesystem. The filename is `agentstore.sqlite`; for another filename, override `AGENTSTORE_DB_PATH` on both services too.

## Configuration

Compose works without an environment file. Optionally copy `.env.example` to `.env` and change:

| Setting | Default | Scope |
| --- | --- | --- |
| `AGENTSTORE_MCP_PORT` | `4311` | Host-side MCP port |
| `AGENTSTORE_DASHBOARD_PORT` | `4310` | Host-side dashboard port |
| `AGENTSTORE_MCP_TOKEN` | Empty | Optional bearer authentication on MCP only |
| `AGENTSTORE_DB_PATH` | Not read by Compose | Native Node setting; Compose uses `/data/agentstore.sqlite` |

Shell environment values override `.env`. Compose does not automatically load `.env.local`; use `docker compose --env-file .env.local ...` explicitly if needed. Native npm commands load `.env`, then `.env.local`; exported environment variables take priority over either file.

If you change the port or enable a token, use the [custom connection instructions](GETTING_STARTED.md#custom-endpoint-or-bearer-token), not the fixed-default bundled connection.

## Network boundary

Services listen on `0.0.0.0` **inside** Docker so port forwarding works, but Compose publishes both ports only on host `127.0.0.1`. Host/origin checks remain enabled. Neither hostname checks nor loopback are authentication: local processes, the Docker host, and containers with access to this project's network must be trusted. Do not attach untrusted containers to that network.

The dashboard has no login and bearer authentication does not protect it. Never publish it publicly. For the development MCP tunnel, require a token and rewrite the upstream Host header to `localhost`. This is still a single-user alpha, not public multi-tenant hosting. See [Security](../SECURITY.md).

## Stop, update, inspect

```bash
docker compose logs --tail 100
docker compose ps
docker compose down
```

`down` removes containers and the network, but retains the database volume. **Do not add `--volumes` or `-v` unless you intend to delete all stored data.**

Before an update, take a backup. After updating your checkout:

```bash
docker compose up --build -d --wait
```

## Backup

Stop **both** writers before copying the entire data directory, including any SQLite sidecars. These commands keep stopped containers available for copying:

```bash
docker compose stop
mkdir -p backups
docker compose cp mcp:/data ./backups/agentstore-backup
docker compose start
```

Use a new backup destination each time. Protect backup contents like the original database. Verify integrity and follow [database operations](DATABASE_OPERATIONS.md) before restoring or migrating. Do not copy only a live `.sqlite` file while omitting its WAL.

## Automated smoke test

Requires Node.js 22+, `npm ci`, and a running Docker engine:

```bash
npm run test:docker
```

The test builds the image, creates a randomly named Compose project on ephemeral loopback ports, and uses two actual MCP SDK clients. It verifies CRUD, metadata-only search, cursor pagination, dashboard sharing, authentication, host/origin rejection, database rows, and persistence after destroying and recreating containers. It also checks the token-free default plugin connection. Finally it removes only its own test containers and volume.

This is protocol/infrastructure testing, not a claim that Claude or Codex always chooses the correct tool in natural-language conversations.
