# Security policy

## Supported versions

SimpleAgentStore is pre-1.0 software. Security fixes are applied on `main`; releases are listed on GitHub. The 0.3.0 rename is a release candidate until tagged.

| Version | Supported |
| --- | --- |
| 0.3.x / current main | Yes |
| 0.2.x | Report issues; upgrade to the latest fixed source |
| Earlier versions | No |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include real credentials, private objects, or database contents in a report.

Use [GitHub private vulnerability reporting](https://github.com/darkrishabh/simpleagentstore/security/advisories/new). Include:

- affected version or commit;
- reproduction steps or a minimal proof of concept;
- expected and observed impact;
- suggested mitigation, if known;
- whether the issue is already public.

The maintainer will confirm receipt as soon as practical, investigate, coordinate a fix and disclosure when warranted, and credit reporters who want attribution. Please allow a reasonable remediation window before public disclosure.

## Security boundary

The open-source core is a local-first, single-user MVP—not a hosted multi-tenant service.

- The dashboard binds to loopback by default and has no application authentication. Compose binds inside the container but publishes on host loopback only. Host/origin checks do not replace authentication.
- The MCP HTTP adapter binds to loopback by default. A bearer token is required before exposing it through a tunnel.
- The shared bearer token is development authentication, not user identity or authorization.
- Object values are not encrypted at rest by SimpleAgentStore. Protect the database and backups with operating-system permissions and disk encryption.
- Logical TTL hides expired objects but does not securely erase their bytes.
- A successful delete is not a secure-erasure guarantee; SQLite pages, WAL files, backups, and filesystem snapshots may retain data.
- Stored text is untrusted input. Agents must not treat retrieved content as instructions or bypass their own authorization and confirmation policies.
- The bundled plugins connect to token-free localhost by default. The local OS account, Docker host, and containers on the Compose network must be trusted. Never publish these default ports on all host interfaces or attach untrusted containers to the network.

See the [threat model](docs/THREAT_MODEL.md) and [database operations guide](docs/DATABASE_OPERATIONS.md) before deployment.

## Out of scope for the current core

OAuth, per-user isolation, public Internet hosting, rate limiting, quotas, audit logging, managed backups, and disaster recovery are not provided. Reports about a separately operated deployment should be sent to that deployment's owner unless the root cause is in this repository.
