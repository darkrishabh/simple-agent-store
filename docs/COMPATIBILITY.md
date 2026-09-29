# Compatibility

SimpleAgentStore is pre-1.0. This matrix defines what the 0.3.x source is designed and tested to support.

## Runtime

| Component | Support |
| --- | --- |
| Node.js | 22 or later; CI currently runs Node.js 22. |
| Package manager | npm with the committed `package-lock.json`; use `npm ci`. |
| SQLite | Supplied through `better-sqlite3`; the release gate currently exercises SQLite 3.53.4. |
| TypeScript | Source and build configuration are validated with the locked compiler version. |

Do not substitute an arbitrary system SQLite library for the version resolved by the lockfile and expect the same behavior.

## Operating systems

- Linux is the continuous-integration release gate.
- macOS is used for local development and manual dashboard/MCP validation.
- Windows is not yet part of the release gate. Reports and contributions that add Windows coverage are welcome.

SQLite databases are portable across supported operating systems, but always move a verified offline backup—not a live WAL-mode file by itself.

## Clients and transports

The core is client-independent. The repository tests MCP tool behavior and the HTTP transport directly. Optional routing manifests are provided for Codex and Claude, but client tool-selection behavior can change independently and is not a deterministic compatibility guarantee.

Supported adapters:

- MCP over stdio;
- MCP Streamable HTTP on loopback;
- local dashboard HTTP on loopback.

Docker Compose v2 packages both HTTP services on published loopback ports with a persistent SQLite volume. The image uses Node.js 22 on Debian Bookworm; native SQLite bindings are built for the target architecture. The Docker CI job exercises Linux; local container testing also runs through Docker on macOS. PostgreSQL is not a supported backend.

Codex and Claude plugin packages include the default local MCP connection and the routing skill. Direct MCP templates are supplied for Codex, Claude-compatible clients, and VS Code. Packaging validators and SDK tests do not prove natural-language tool selection in every client/version.

The development Cloudflare tunnel is convenience tooling, not a supported hosted-service environment.

## Database upgrades

The 0.3.x code supports databases created by the earlier MVP schema through automatic additive migration and index backfill. The rename preserves the 0.2.x data format and default storage paths. Downgrade-in-place after a schema migration is not supported. See [Database operations](DATABASE_OPERATIONS.md) and [upgrading](UPGRADING.md).

## Versioning

The core and distributed plugin manifests use one version. Pre-1.0 minor releases may change APIs or the database format, with changes documented in the changelog and a migration path when stored data is affected.
