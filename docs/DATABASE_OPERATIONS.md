# Database operations

SimpleAgentStore uses SQLite in WAL mode. The default database is `data/agentstore.sqlite`; `AGENTSTORE_DB_PATH` selects another file. These procedures assume one local owner and filesystem.

## Safety rules

- Back up before upgrading SimpleAgentStore or changing the schema.
- Stop the dashboard and every MCP process before moving or restoring a database.
- Keep the database, `-wal`, and `-shm` files private. Never commit them.
- Do not put a live database on Dropbox, NFS, SMB, or another generic network-synchronized filesystem.
- Test recovery with a copy. A backup that has never been restored is unverified.

## Consistent backup

The simplest backup is offline:

1. Stop the dashboard and MCP processes and confirm no process has the database open.
2. Copy the main database to protected storage.
3. Verify the copy before relying on it.

```bash
mkdir -p backups
cp data/agentstore.sqlite backups/agentstore.sqlite
sqlite3 backups/agentstore.sqlite 'PRAGMA quick_check;'
```

A healthy check prints `ok`. After the last connection closes normally, SQLite checkpoints WAL changes into the main file. If you cannot stop writers, use SQLite's online backup API through the `sqlite3` shell instead of copying files independently:

```bash
mkdir -p backups
sqlite3 data/agentstore.sqlite ".backup 'backups/agentstore.sqlite'"
sqlite3 backups/agentstore.sqlite 'PRAGMA quick_check;'
```

Protect backups with appropriate filesystem permissions and disk encryption. SimpleAgentStore does not encrypt them.

## Restore

1. Stop every SimpleAgentStore process.
2. Move the current database, `-wal`, and `-shm` files aside; do not overwrite the only recoverable copy.
3. Copy the verified backup to the configured database path.
4. Start one SimpleAgentStore process. Opening the store runs compatible migrations.
5. Check `/health`, open the dashboard, and verify representative keys and counts before resuming normal use.

Example with the default path:

```bash
mkdir -p data/pre-restore
mv data/agentstore.sqlite data/pre-restore/ 2>/dev/null || true
mv data/agentstore.sqlite-wal data/pre-restore/ 2>/dev/null || true
mv data/agentstore.sqlite-shm data/pre-restore/ 2>/dev/null || true
cp backups/agentstore.sqlite data/agentstore.sqlite
sqlite3 data/agentstore.sqlite 'PRAGMA quick_check;'
```

## Export and import

Version 0.3.0 does not define a stable logical bulk-export format. Use a verified SQLite backup for lossless transfer between compatible SimpleAgentStore versions. Do not treat dashboard JSON copy or search results as a complete export: search omits full values and lists are paginated.

A future logical export must preserve stable keys, complete values, behavioral fields, timestamps, versions, and a format version. Until then, applications that require a portable domain export should traverse every `listPage` cursor, call `get` for each key, and define their own versioned format.

## Schema migrations

Opening a database applies current additive migrations and index backfills automatically. Migration tests cover the supported legacy schema. The current policy is:

- back up before upgrading;
- migrate forward on open;
- do not downgrade a migrated database in place;
- restore the pre-upgrade backup to roll back;
- preserve caller-owned keys, values, IDs, and timestamps across compatible migrations;
- require a tested migration and changelog entry for every schema change.

The database format is pre-1.0 and may change between minor releases. Breaking migrations must be announced before release and include an explicit migration path.

## Locking and concurrent access

WAL mode supports concurrent readers and a single writer at a time. Each `put` and its label-index update run in one transaction. Multiple processes can use one local database, but write-heavy concurrency can return SQLite busy errors; no distributed lock or retry queue is provided.

Writes to the same key are last-commit-wins. The `version` field increments after each successful upsert, but version preconditions are not currently accepted.

## Integrity and corruption recovery

Run checks on a copy or during maintenance:

```bash
sqlite3 data/agentstore.sqlite 'PRAGMA quick_check;'
sqlite3 data/agentstore.sqlite 'PRAGMA integrity_check;'
```

If a check fails:

1. Stop all writers immediately.
2. Preserve the database and its WAL/SHM files for diagnosis.
3. Restore the newest verified backup to a new path.
4. Run `PRAGMA integrity_check` on the restored file.
5. Point `AGENTSTORE_DB_PATH` to the restored file and verify representative objects.

SQLite recovery tooling can sometimes salvage data, but recovered output is not trusted until validated. Prefer a known-good backup.

## Retention and deletion

TTL is logical visibility, not physical deletion. Expired rows remain in the database. Deletion also does not guarantee secure erasure because old bytes can remain in SQLite pages, WAL files, backups, and filesystem snapshots. Define and test a separate retention process before storing regulated or highly sensitive data.
