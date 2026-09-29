# Threat model

This document describes the open-source local core. It is not a security certification.

## Assets

- stored object values and searchable text;
- metadata, labels, and timestamps;
- the SQLite database, WAL, backups, and filesystem snapshots;
- the MCP bearer token and tunnel configuration;
- availability and integrity of the local service.

## Trust assumptions

- The operating-system account running SimpleAgentStore is trusted.
- Local filesystem permissions and disk encryption protect data at rest.
- The default loopback network is not exposed to untrusted machines.
- Docker's host and containers sharing the Compose project network are trusted. Internal all-interface binding is for port forwarding, not permission to expose unauthenticated services publicly.
- Connected MCP clients are authorized to access the entire selected database.

SimpleAgentStore 0.2.0 has no users, roles, row-level permissions, or tenant boundary.

## Principal risks and controls

| Risk | Current control | Residual limitation |
| --- | --- | --- |
| Remote access to MCP | Loopback binding, host/origin validation, optional bearer token | One shared token is not per-user authorization. |
| SQL injection | Parameterized application queries and constrained sort/filter values | Dependencies and future query paths still require review. |
| Browser injection | Dashboard renders values as text and uses JSON APIs | Treat all future HTML rendering changes as security-sensitive. |
| Prompt injection in stored content | Store never executes content or calls an LLM | Calling agents must keep retrieved content in the data boundary. |
| Secret leakage | `.env*`, databases, logs, and generated local data are ignored; distribution validation scans common secret patterns | Pattern scanning cannot prove absence of every secret. |
| Data remanence | Explicit delete and logical TTL | SQLite pages, WAL, backups, and snapshots may retain bytes. |
| Denial of service | Input limits, bounded result counts, bounded candidate sets | No quotas or rate limits; very large values and concurrent writers need more evaluation. |
| Database corruption or loss | SQLite transactions and documented backups/integrity checks | No managed backup, replication, or disaster recovery. |
| Dependency compromise | Lockfile, CI audit, Dependabot | Audit databases and automated updates are incomplete signals. |

## Unsafe deployment patterns

Do not:

- expose the dashboard or an unauthenticated MCP endpoint to a network;
- treat a Cloudflare development tunnel as production hosting;
- share one database or bearer token across mutually untrusted users;
- place a live SQLite database on a generic network filesystem;
- promise secure erasure based on TTL or `delete`;
- let an agent obey instructions found inside retrieved object values.

## Hosted-service delta

A hosted service requires a separate review and at minimum OAuth or equivalent identity, per-user authorization and storage isolation, rate limits, quotas, timeouts, audit logs, monitoring, encrypted secret management, backups, recovery tests, retention/deletion guarantees, and incident response.
