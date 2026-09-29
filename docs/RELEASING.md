# Releasing SimpleAgentStore

This is the maintainer checklist for source releases. SimpleAgentStore is not currently published to npm; `private: true` prevents accidental registry publication.

## Prepare

1. Confirm the target scope and version under Semantic Versioning.
2. Update the core and all plugin/marketplace manifests to the same version.
3. Move user-visible entries from `Unreleased` to the dated release section in `CHANGELOG.md`.
4. Review migrations and restore a pre-upgrade fixture.
5. Review dependencies, license compatibility, generated assets, machine paths, secrets, personal data, and packaged files.
6. Run the full gate from a clean checkout:

```bash
npm ci
npm run release:check
npm run test:docker
```

7. Test the dashboard and both MCP transports against an isolated database.
8. Validate the Codex and Claude plugin packages with their current client tooling.

## Publish

1. Merge the release commit to `main` only after CI passes.
2. Create a signed or annotated tag matching `package.json`, for example `v0.3.0`. Do not treat a version bump or passing local tests as a published release.
3. Push the tag and create a GitHub release from the matching changelog section.
4. Confirm the release archive contains no database, environment file, log, credential, or machine-specific path.
5. Re-run the documented fresh-clone setup from the public repository.

## After release

- Confirm the README banner, links, CI badge, license, and security reporting link render publicly.
- Install both routing plugins from the released source and test ordinary save/retrieve prompts.
- Record any known limitations in the release notes.
- Never describe the local core as a production hosted or multi-tenant service.
