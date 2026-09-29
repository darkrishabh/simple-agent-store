# Open-source readiness

SimpleAgentStore 0.3.0 is being prepared as an open-source **local alpha**, not a stable 1.0 or hosted service. A version bump is not a published release; merge passing CI and follow [the release checklist](docs/RELEASING.md) before tagging.

## Source-release baseline

| Area | Status | Evidence |
| --- | --- | --- |
| License | Ready | Apache License 2.0 in `LICENSE`; package metadata declares `Apache-2.0`. |
| Reproducible install | Ready | Node.js 22+, committed lockfile, and fresh `npm ci` validation. |
| Container setup | Ready for local alpha | Compose starts MCP and dashboard with a shared SQLite volume; `npm run test:docker` verifies cross-client retrieval and persistence after container recreation. |
| Client integrations | Packaged | Codex and Claude plugins bundle local MCP plus routing; direct MCP examples support custom connections. Model routing is not guaranteed. |
| Automated quality gate | Ready | GitHub Actions runs type-checking, tests, build, distribution validation, documentation checks, audit, and package inspection. |
| Tests | Ready for alpha | CRUD, versioning, TTL, retrieval, migration, pagination, MCP, and HTTP-authentication coverage. |
| Secret/data hygiene | Ready for alpha | Environment files, databases, logs, dependencies, and build output are ignored; release validation scans common secret patterns and absolute user paths. |
| Community health | Ready | Contribution guide, code of conduct, support policy, security policy, issue forms, PR template, and code ownership. |
| Architecture | Ready | Core/adapters boundary, object contract, retrieval pipeline, concurrency, non-goals, and threat model documented. |
| Operations | Ready for local alpha | Backup, restore, integrity, migrations, locking, corruption recovery, retention, and deletion limitations documented. |
| Dependency maintenance | Ready | Locked dependencies, CI audit, and weekly Dependabot checks for npm and GitHub Actions. |
| Release process | Prepared | Unified `0.3.0` version and documented maintainer release gate; release/tag publication is a separate step. |

Run the local release gate with:

```bash
npm ci
npm run release:check
npm run test:docker
```

## Launch verification — 2026-09-29

- Node.js 22: 51 automated tests pass, including both MCP transports, timezone-aware list filters, filtered pagination, legacy migration and restart persistence.
- Isolated Docker stack: real MCP SDK clients verified cross-client save/search/get, updates, deletes, pagination, direct database contents, auth, network guards, and data survival after container recreation. The default legacy volume name is also asserted.
- Codex plugin/skill validators and Claude Code's plugin/marketplace validators pass. These are packaging checks, not a fresh natural-language conversation test in either product.
- Dependency audit reports zero known vulnerabilities at verification time. Distribution and actual package-manifest checks pass; no user database or environment secrets are included.
- GitHub repository renamed to `darkrishabh/simpleagentstore`; private vulnerability reporting, secret scanning and push protection confirmed enabled.
- Dashboard wordmark and new SVG README banner visually checked against an isolated empty database.

Before publishing: require both GitHub CI jobs to pass on the final commit, complete the fresh-clone gate, and create the release/tag through the documented checklist. Domain registration is not website or hosted-MCP deployment.

## Explicit alpha limitations

- No stable logical bulk-export format; verified SQLite backup is the lossless transfer mechanism.
- The database format is pre-1.0. Compatible migrations are automatic, but rollback means restoring the pre-upgrade backup.
- Concurrent writes to one key are last-commit-wins; version preconditions are not accepted.
- TTL controls visibility, not physical deletion or secure erasure.
- Lexical retrieval can miss paraphrases and typos and should be evaluated with real queries.
- Security scanning and dependency audits reduce risk but are not proof of security.
- The package remains `private: true` because this release is distributed as source and plugins from GitHub, not through npm.

## Before declaring a stable 1.0 core

- Version and publish a stable logical export/import format.
- Formalize schema-version tracking and supported upgrade spans.
- Add optimistic write preconditions if multi-writer use becomes a supported scenario.
- Expand retrieval evaluation with independently reviewed labels, real paraphrases, typos, abbreviations, multilingual queries, and hard negatives.
- Run sustained concurrent-reader/writer and crash-recovery tests on supported platforms.
- Define a long-term support and deprecation policy.

## Not ready: hosted managed service or public multi-user MCP

The open-source core does not provide:

- OAuth or per-user identity;
- tenant isolation or row-level authorization;
- production rate limits, quotas, request budgets, or abuse controls;
- managed audit logs, metrics, alerts, backups, or disaster recovery;
- retention/deletion guarantees, privacy terms, or an incident-response organization;
- a stable production HTTPS service.

The development Cloudflare tunnel and shared bearer token must not be presented as those capabilities. A hosted product requires separate architecture, security review, operations, and testing.

## Benchmark publication rule

The separate comparison harness is useful engineering evidence, not a single winner score. Before using comparative metrics publicly, independently review the relevance labels, publish the raw query-level results and source hashes, identify local versus hosted measurements, and report retrieval, latency, storage, write throughput, and capability support as separate dimensions.
