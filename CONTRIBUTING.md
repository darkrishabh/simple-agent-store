# Contributing to SimpleAgentStore

Thanks for helping make SimpleAgentStore simpler, safer, and more useful across agents.

## Before opening a change

- Search existing issues and pull requests.
- For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- For a substantial feature or schema change, open an issue first so the contract can be discussed before implementation.

## Product boundary

SimpleAgentStore is a deterministic, user-owned object store. Natural-language interpretation belongs in the calling agent. The core executes structured filters and lexical retrieval.

Changes that introduce embeddings, RAG, autonomous classification, a knowledge graph, workflow execution, or a hosted multi-user control plane are outside the core unless the project scope is explicitly changed first.

## Development setup

Requires Node.js 22 or later.

```bash
git clone https://github.com/darkrishabh/simple-agent-store.git
cd simple-agent-store
npm ci
npm run ci
```

Use `npm run dashboard` for the local UI and `npm run mcp:http` for the local Streamable HTTP adapter. Development databases and `.env.local` are ignored by Git.

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for observable behavior.
3. Preserve existing databases or include a tested migration.
4. Update the relevant documentation and `CHANGELOG.md` for user-visible changes.
5. Run `npm run release:check`.
6. Open a pull request using the repository template.

Keep changes small enough to review. Avoid unrelated formatting or generated dependency churn. Never commit bearer tokens, tunnel identifiers, personal data, SQLite databases, logs, or machine-specific absolute paths.

## Database changes

Schema changes must be backward compatible with the previous released database unless a breaking release is explicitly planned. Add a migration test that opens a representative older database and confirms its data and indexes after upgrade. See [Database operations](docs/DATABASE_OPERATIONS.md).

## Commit and review expectations

- Use clear imperative commit messages.
- Explain the user-visible behavior and tradeoffs in the pull request.
- Link the relevant issue when one exists.
- Respond to review feedback with code or a concrete rationale.

Contributions submitted for inclusion are licensed under the repository's [Apache License 2.0](LICENSE), as described by that license's contribution terms.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
