# Changelog

All notable changes to SimpleAgentStore are documented here. The project follows [Semantic Versioning](https://semver.org/) while recognizing that pre-1.0 releases may change the API.

## [Unreleased]

### Changed

- Renamed the project, GitHub repository, dashboard, MCP identity and distributed plugins to SimpleAgentStore (`simpleagentstore`); prepared version 0.3.0 and the `simpleagentstore.com` homepage metadata.
- Kept `AGENTSTORE_*`, the SQLite filename, core class and five tool names compatible. Pinned the original Compose project name to avoid silently replacing the default data volume after a folder rename. Added upgrade instructions for existing installs and custom project names.
- Updated the README banner and added a fail-closed package-content check to the release gate and CI.

### Added

- Open-source governance, security, CI, operational, and release documentation.
- Docker Compose setup with persistent shared SQLite storage, health checks, non-root runtime, and loopback-only published ports.
- Bundled local MCP connections in Codex/Claude plugins plus standalone MCP configuration examples for Codex, Claude-compatible clients, and VS Code.
- Shared native database/port configuration, environment-file examples, Docker operations documentation, and isolated Docker end-to-end tests in CI.

### Fixed

- List due-date filters now normalize timezone offsets consistently with search and reject invalid dates.
- MCP upsert annotations accurately describe overwrites and version increments, rather than advertising non-destructive idempotence.

- Dashboard now rejects untrusted Host/Origin headers and locates its static files independently of the invoking client's working directory.
- Database path settings reject connection URLs and transient storage instead of silently treating them as SQLite filenames; HTTP port settings reject partial numbers.
- MCP server version now matches the core and plugin manifests.

## [0.2.0] - 2026-09-23

### Added

- Deterministic SQLite object-store core with `put`, `get`, `list`, `search`, and `delete`.
- Standard object metadata, versioning, logical TTL, and constrained object kinds.
- Bounded FTS5, indexed labels, shape retrieval, structured filters, and cursor pagination.
- Stdio and Streamable HTTP MCP adapters with five corresponding tools.
- Local CRUD dashboard over the same database.
- Optional routing plugins for Codex and Claude.
- Migration, scale-boundary, HTTP authentication, MCP, pagination, and CRUD tests.

### Security

- Loopback defaults, optional bearer-token authentication, environment-only tunnel configuration, and secret/data exclusions.

[Unreleased]: https://github.com/darkrishabh/simpleagentstore/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/darkrishabh/simpleagentstore/releases/tag/v0.2.0
