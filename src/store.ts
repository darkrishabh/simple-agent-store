import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  OBJECT_KINDS,
  type JsonObject,
  type ListObjectsInput,
  type ListObjectsPage,
  type ObjectKind,
  type ObjectMetadata,
  type PutObjectInput,
  type SearchObjectsInput,
  type SearchResult,
  type StoreStats,
  type StoredObject,
} from "./types.js";

interface ItemRow {
  rowid: number;
  id: string;
  key: string;
  kind: ObjectKind;
  value_json: string;
  searchable_text: string;
  description: string | null;
  labels_json: string;
  source_client: string | null;
  due_at: string | null;
  start_at: string | null;
  end_at: string | null;
  completed: number | null;
  has_phone: number;
  has_email: number;
  has_url: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface RankedItemRow extends ItemRow {
  fts_rank: number;
}

interface Candidate {
  row: ItemRow;
  score: number;
  matchedFields: Set<string>;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "did",
  "do",
  "does",
  "for",
  "get",
  "has",
  "have",
  "i",
  "in",
  "me",
  "my",
  "of",
  "on",
  "or",
  "save",
  "saved",
  "that",
  "the",
  "thing",
  "to",
  "was",
  "what",
  "which",
  "who",
]);

const PHONE_PATTERN = /(?:\+?\d[\d .()-]{7,}\d)/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/i;

export class AgentStore {
  private readonly db: Database.Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.createSchema();
  }

  close(): void {
    this.db.close();
  }

  put(input: PutObjectInput, options: { now?: string } = {}): StoredObject {
    const clean = validatePutInput(input);
    const now = normalizeTimestamp(options.now ?? new Date().toISOString(), "now");
    const shapes = detectShapes(clean.searchableText);
    const write = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT rowid, * FROM items WHERE key = ?")
        .get(clean.key) as ItemRow | undefined;

      if (existing) {
        this.db
        .prepare(`
          UPDATE items SET
            kind = ?, value_json = ?, searchable_text = ?, description = ?,
            labels_json = ?, source_client = ?, due_at = ?, start_at = ?,
            end_at = ?, completed = ?, expires_at = ?, has_phone = ?,
            has_email = ?, has_url = ?, updated_at = ?, version = ?
          WHERE key = ?
        `)
        .run(
          clean.kind,
          JSON.stringify(clean.value),
          clean.searchableText,
          clean.description,
          JSON.stringify(clean.labels),
          clean.sourceClient,
          clean.dueAt,
          clean.startAt,
          clean.endAt,
          booleanToSql(clean.completed),
          clean.expiresAt,
          shapes.phone ? 1 : 0,
          shapes.email ? 1 : 0,
          shapes.url ? 1 : 0,
          now,
          existing.version + 1,
          clean.key,
        );
      } else {
        this.db
        .prepare(`
          INSERT INTO items (
            id, key, kind, value_json, searchable_text, description, labels_json,
            source_client, due_at, start_at, end_at, completed, expires_at,
            has_phone, has_email, has_url, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `)
        .run(
          randomUUID(),
          clean.key,
          clean.kind,
          JSON.stringify(clean.value),
          clean.searchableText,
          clean.description,
          JSON.stringify(clean.labels),
          clean.sourceClient,
          clean.dueAt,
          clean.startAt,
          clean.endAt,
          booleanToSql(clean.completed),
          clean.expiresAt,
          shapes.phone ? 1 : 0,
          shapes.email ? 1 : 0,
          shapes.url ? 1 : 0,
          now,
          now,
        );
      }

      const item = this.db.prepare("SELECT id FROM items WHERE key = ?").get(clean.key) as { id: string };
      this.syncLabels(item.id, clean.labels);
    });
    write();

    const stored = this.get(clean.key, { includeExpired: true });
    if (!stored) throw new Error(`Failed to store object: ${clean.key}`);
    return stored;
  }

  get(key: string, options: { includeExpired?: boolean } = {}): StoredObject | null {
    const cleanKey = validateKey(key);
    const clauses = ["key = ?"];
    const params: unknown[] = [cleanKey];
    if (!options.includeExpired) {
      clauses.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(new Date().toISOString());
    }

    const row = this.db
      .prepare(`SELECT rowid, * FROM items WHERE ${clauses.join(" AND ")}`)
      .get(...params) as ItemRow | undefined;
    return row ? rowToObject(row) : null;
  }

  list(input: ListObjectsInput = {}): ObjectMetadata[] {
    return this.listPage(input).objects;
  }

  listPage(input: ListObjectsInput = {}): ListObjectsPage {
    const limit = clampLimit(input.limit, 20, 100);
    const filter = buildFilterSql(
      {
        kind: input.kind,
        sourceClient: input.sourceClient,
        labels: input.labels,
        dueBefore: normalizeOptionalTimestamp(input.dueBefore, "dueBefore") ?? undefined,
        completed: input.completed,
      },
      new Date().toISOString(),
    );
    let { sql } = filter;
    const { params } = filter;
    const totalCount = (this.db.prepare(`SELECT count(*) AS count FROM items i WHERE ${sql}`)
      .get(...params) as { count: number }).count;
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (cursor) {
      sql += " AND (i.created_at < ? OR (i.created_at = ? AND i.key > ?))";
      params.push(cursor.createdAt, cursor.createdAt, cursor.key);
    }
    const rows = this.db
      .prepare(`SELECT i.rowid, i.* FROM items i WHERE ${sql} ORDER BY i.created_at DESC, i.key ASC LIMIT ?`)
      .all(...params, limit + 1) as ItemRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      objects: pageRows.map((row) => toMetadata(rowToObject(row))),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.key) : null,
      totalCount,
    };
  }

  stats(): StoreStats {
    const now = new Date().toISOString();
    const active = "expires_at IS NULL OR expires_at > ?";
    const summary = this.db.prepare(`
      SELECT count(*) AS total,
        count(DISTINCT source_client) AS source_count,
        sum(CASE WHEN due_at IS NOT NULL OR start_at IS NOT NULL THEN 1 ELSE 0 END) AS scheduled,
        sum(CASE WHEN expires_at IS NOT NULL THEN 1 ELSE 0 END) AS expiring
      FROM items WHERE ${active}
    `).get(now) as { total: number; source_count: number; scheduled: number | null; expiring: number | null };
    const kindRows = this.db.prepare(`SELECT kind, count(*) AS count FROM items WHERE ${active} GROUP BY kind`)
      .all(now) as Array<{ kind: ObjectKind; count: number }>;
    const sourceRows = this.db.prepare(`SELECT DISTINCT source_client FROM items WHERE ${active} AND source_client IS NOT NULL ORDER BY source_client`)
      .all(now) as Array<{ source_client: string }>;
    const byKind = Object.fromEntries(OBJECT_KINDS.map((kind) => [kind, 0])) as Record<ObjectKind, number>;
    for (const row of kindRows) byKind[row.kind] = row.count;
    return {
      total: summary.total,
      byKind,
      sourceCount: summary.source_count,
      sources: sourceRows.map((row) => row.source_client),
      scheduled: summary.scheduled ?? 0,
      expiring: summary.expiring ?? 0,
    };
  }

  search(input: SearchObjectsInput = {}): SearchResult[] {
    const limit = clampLimit(input.limit, 10, 50);
    const now = new Date().toISOString();
    const normalizedInput = normalizeSearchInput(input);
    const { sql, params } = buildFilterSql(normalizedInput, now);
    const query = input.query?.trim() ?? "";
    if (!query) {
      const order = sqlOrder(input.sort ?? "created_desc");
      const rows = this.db.prepare(`SELECT i.rowid, i.* FROM items i WHERE ${sql} ORDER BY ${order} LIMIT ?`)
        .all(...params, limit) as ItemRow[];
      return rows.map((row) => candidateToResult({ row, score: 1, matchedFields: new Set(["structured_filters"]) }));
    }

    const tokens = tokenize(query);
    const candidates = new Map<string, Candidate>();
    const ftsQuery = toFtsQuery(tokens);
    const candidateLimit = Math.min(1000, Math.max(100, limit * 10));

    if (ftsQuery) {
      const rankedRows = this.db
        .prepare(`
          SELECT i.rowid, i.*,
            bm25(items_fts, 8.0, 2.0, 3.0, 6.0) AS fts_rank
          FROM items_fts
          JOIN items i ON i.rowid = items_fts.rowid
          WHERE items_fts MATCH ? AND ${sql}
          ORDER BY fts_rank ASC
          LIMIT ?
        `)
        .all(ftsQuery, ...params, candidateLimit) as RankedItemRow[];

      for (const row of rankedRows) {
        const candidate = getCandidate(candidates, row);
        candidate.score += 0.5 + 0.15 / (1 + Math.abs(row.fts_rank));
        addMatchedFields(candidate, row, tokens);
      }
    }

    if (tokens.length) {
      const labelClauses = tokens.map(() => "l.label LIKE ? ESCAPE '\\'").join(" OR ");
      const labelParams = tokens.map((token) => `${escapeLike(token)}%`);
      const labelRows = this.db.prepare(`
        SELECT DISTINCT i.rowid, i.* FROM item_labels l
        JOIN items i ON i.id = l.item_id
        WHERE (${labelClauses}) AND ${sql}
        LIMIT ?
      `).all(...labelParams, ...params, candidateLimit) as ItemRow[];
      for (const row of labelRows) {
        const candidate = getCandidate(candidates, row);
        const labels = parseLabels(row.labels_json).map(normalizeText);
        const hits = tokens.filter((token) => labels.some((label) => label.startsWith(token))).length;
        candidate.score += 0.15 + 0.15 * (hits / tokens.length);
        candidate.matchedFields.add("labels");
      }
    }

    const requestedShapes = requestedShapeColumns(query);
    if (requestedShapes.length) {
      const shapeSql = requestedShapes.map(({ column }) => `i.${column} = 1`).join(" OR ");
      const shapeRows = this.db.prepare(`SELECT i.rowid, i.* FROM items i WHERE (${shapeSql}) AND ${sql} LIMIT ?`)
        .all(...params, candidateLimit) as ItemRow[];
      for (const row of shapeRows) {
        const candidate = getCandidate(candidates, row);
        candidate.score += 0.35;
        for (const shape of requestedShapes) {
          if (row[shape.column] === 1) candidate.matchedFields.add(shape.field);
        }
      }
    }

    return sortCandidates([...candidates.values()], input.sort ?? "relevance")
      .slice(0, limit)
      .map(candidateToResult);
  }

  delete(key: string): boolean {
    const result = this.db.prepare("DELETE FROM items WHERE key = ?").run(validateKey(key));
    return result.changes > 0;
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('note', 'todo', 'reminder', 'calendar', 'reference', 'other')),
        value_json TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        description TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]',
        source_client TEXT,
        due_at TEXT,
        start_at TEXT,
        end_at TEXT,
        completed INTEGER CHECK (completed IS NULL OR completed IN (0, 1)),
        expires_at TEXT,
        has_phone INTEGER NOT NULL DEFAULT 0 CHECK (has_phone IN (0, 1)),
        has_email INTEGER NOT NULL DEFAULT 0 CHECK (has_email IN (0, 1)),
        has_url INTEGER NOT NULL DEFAULT 0 CHECK (has_url IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1)
      );

      CREATE INDEX IF NOT EXISTS items_kind_idx ON items(kind);
      CREATE INDEX IF NOT EXISTS items_source_client_idx ON items(source_client);
      CREATE INDEX IF NOT EXISTS items_created_at_idx ON items(created_at);
      CREATE INDEX IF NOT EXISTS items_due_at_idx ON items(due_at);
      CREATE INDEX IF NOT EXISTS items_expires_at_idx ON items(expires_at);
    `);

    const needsShapeBackfill = [
      this.ensureColumn("has_phone", "INTEGER NOT NULL DEFAULT 0"),
      this.ensureColumn("has_email", "INTEGER NOT NULL DEFAULT 0"),
      this.ensureColumn("has_url", "INTEGER NOT NULL DEFAULT 0"),
    ].some(Boolean);
    const needsLabelBackfill = !this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'item_labels'")
      .pluck().get();

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS items_has_phone_idx ON items(has_phone) WHERE has_phone = 1;
      CREATE INDEX IF NOT EXISTS items_has_email_idx ON items(has_email) WHERE has_email = 1;
      CREATE INDEX IF NOT EXISTS items_has_url_idx ON items(has_url) WHERE has_url = 1;
      CREATE TABLE IF NOT EXISTS item_labels (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        label TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (item_id, label)
      );
      CREATE INDEX IF NOT EXISTS item_labels_label_idx ON item_labels(label, item_id);
    `);

    if (needsLabelBackfill) {
      this.db.exec(`
      INSERT OR IGNORE INTO item_labels(item_id, label)
      SELECT i.id, lower(json_each.value) FROM items i, json_each(i.labels_json)
      WHERE json_valid(i.labels_json) AND json_each.type = 'text';
      `);
    }

    if (needsShapeBackfill) {
      const shapeRows = this.db.prepare("SELECT id, searchable_text FROM items")
        .all() as Array<{ id: string; searchable_text: string }>;
      const updateShapes = this.db.prepare("UPDATE items SET has_phone = ?, has_email = ?, has_url = ? WHERE id = ?");
      const backfillShapes = this.db.transaction(() => {
        for (const row of shapeRows) {
          const shapes = detectShapes(row.searchable_text);
          updateShapes.run(shapes.phone ? 1 : 0, shapes.email ? 1 : 0, shapes.url ? 1 : 0, row.id);
        }
      });
      backfillShapes();
    }

    const ftsDefinition = this.db
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'items_fts'")
      .pluck()
      .get() as string | undefined;
    const rebuildFts = !ftsDefinition || ftsDefinition.includes("content='items'");

    if (ftsDefinition?.includes("content='items'")) {
      this.db.exec(`
        DROP TRIGGER IF EXISTS items_ai;
        DROP TRIGGER IF EXISTS items_ad;
        DROP TRIGGER IF EXISTS items_au;
        DROP TABLE items_fts;
      `);
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        key,
        searchable_text,
        description,
        labels,
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, key, searchable_text, description, labels)
        VALUES (new.rowid, new.key, new.searchable_text, coalesce(new.description, ''), new.labels_json);
      END;

      CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
        DELETE FROM items_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
        DELETE FROM items_fts WHERE rowid = old.rowid;
        INSERT INTO items_fts(rowid, key, searchable_text, description, labels)
        VALUES (new.rowid, new.key, new.searchable_text, coalesce(new.description, ''), new.labels_json);
      END;
    `);

    if (rebuildFts) {
      this.db.exec(`
        INSERT INTO items_fts(rowid, key, searchable_text, description, labels)
        SELECT rowid, key, searchable_text, coalesce(description, ''), labels_json FROM items;
      `);
    }
    this.db.pragma("optimize");
  }

  private ensureColumn(name: string, definition: string): boolean {
    const columns = this.db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
      return true;
    }
    return false;
  }

  private syncLabels(itemId: string, labels: string[]): void {
    this.db.prepare("DELETE FROM item_labels WHERE item_id = ?").run(itemId);
    const insert = this.db.prepare("INSERT INTO item_labels(item_id, label) VALUES (?, ?)");
    for (const label of labels) insert.run(itemId, label);
  }
}

export function toMetadata(object: StoredObject): ObjectMetadata {
  const { value: _value, searchableText: _searchableText, ...metadata } = object;
  return metadata;
}

function validatePutInput(input: PutObjectInput): Required<PutObjectInput> {
  if (!OBJECT_KINDS.includes(input.kind)) throw new Error(`Invalid kind: ${input.kind}`);
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    throw new Error("value must be a JSON object");
  }
  const searchableText = input.searchableText?.trim();
  if (!searchableText) throw new Error("searchableText is required");

  return {
    key: validateKey(input.key),
    kind: input.kind,
    value: input.value,
    searchableText,
    description: cleanOptionalString(input.description),
    labels: normalizeLabels(input.labels ?? []),
    sourceClient: cleanOptionalString(input.sourceClient),
    dueAt: normalizeOptionalTimestamp(input.dueAt, "dueAt"),
    startAt: normalizeOptionalTimestamp(input.startAt, "startAt"),
    endAt: normalizeOptionalTimestamp(input.endAt, "endAt"),
    completed: input.completed ?? null,
    expiresAt: normalizeOptionalTimestamp(input.expiresAt, "expiresAt"),
  };
}

function validateKey(key: string): string {
  const clean = key?.trim();
  if (!clean) throw new Error("key is required");
  if (clean.length > 200) throw new Error("key must be 200 characters or fewer");
  return clean;
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function normalizeTimestamp(value: string, field: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${field} must be a valid ISO-8601 timestamp`);
  return timestamp.toISOString();
}

function normalizeOptionalTimestamp(value: string | null | undefined, field: string): string | null {
  return value ? normalizeTimestamp(value, field) : null;
}

function normalizeSearchInput(input: SearchObjectsInput): SearchObjectsInput {
  return {
    ...input,
    createdAfter: normalizeOptionalTimestamp(input.createdAfter, "createdAfter") ?? undefined,
    createdBefore: normalizeOptionalTimestamp(input.createdBefore, "createdBefore") ?? undefined,
    updatedAfter: normalizeOptionalTimestamp(input.updatedAfter, "updatedAfter") ?? undefined,
    updatedBefore: normalizeOptionalTimestamp(input.updatedBefore, "updatedBefore") ?? undefined,
    dueAfter: normalizeOptionalTimestamp(input.dueAfter, "dueAfter") ?? undefined,
    dueBefore: normalizeOptionalTimestamp(input.dueBefore, "dueBefore") ?? undefined,
  };
}

function booleanToSql(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function rowToObject(row: ItemRow): StoredObject {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    value: JSON.parse(row.value_json) as JsonObject,
    searchableText: row.searchable_text,
    description: row.description,
    labels: parseLabels(row.labels_json),
    sourceClient: row.source_client,
    dueAt: row.due_at,
    startAt: row.start_at,
    endAt: row.end_at,
    completed: row.completed === null ? null : row.completed === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function parseLabels(value: string): string[] {
  return JSON.parse(value) as string[];
}

function buildFilterSql(input: SearchObjectsInput, now: string): { sql: string; params: unknown[] } {
  const clauses = ["(i.expires_at IS NULL OR i.expires_at > ?)"];
  const params: unknown[] = [now];

  addArrayFilter(clauses, params, "i.kind", input.kind);
  addArrayFilter(clauses, params, "i.source_client", input.sourceClient);
  addBound(clauses, params, "i.created_at", ">=", input.createdAfter);
  addBound(clauses, params, "i.created_at", "<", input.createdBefore);
  addBound(clauses, params, "i.updated_at", ">=", input.updatedAfter);
  addBound(clauses, params, "i.updated_at", "<", input.updatedBefore);
  addBound(clauses, params, "i.due_at", ">=", input.dueAfter);
  addBound(clauses, params, "i.due_at", "<", input.dueBefore);

  if (input.completed !== undefined) {
    clauses.push("i.completed = ?");
    params.push(input.completed ? 1 : 0);
  }
  if (input.keyPrefix) {
    clauses.push("i.key LIKE ? ESCAPE '\\'");
    params.push(`${escapeLike(input.keyPrefix)}%`);
  }
  for (const label of normalizeLabels(input.labels ?? [])) {
    clauses.push("EXISTS (SELECT 1 FROM item_labels il WHERE il.item_id = i.id AND il.label = ?)");
    params.push(label);
  }

  return { sql: clauses.join(" AND "), params };
}

function addArrayFilter(
  clauses: string[],
  params: unknown[],
  field: string,
  values: readonly string[] | undefined,
): void {
  if (!values?.length) return;
  clauses.push(`${field} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function addBound(
  clauses: string[],
  params: unknown[],
  field: string,
  operator: ">=" | "<",
  value: string | undefined,
): void {
  if (!value) return;
  clauses.push(`${field} ${operator} ?`);
  params.push(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function clampLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("limit must be a positive integer");
  return Math.min(value, maximum);
}

function tokenize(query: string): string[] {
  const raw = normalizeText(query).match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(raw.filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

function normalizeText(value: string): string {
  return value.normalize("NFKD").toLowerCase();
}

function toFtsQuery(tokens: string[]): string | null {
  return tokens.length
    ? tokens.map((token) => `"${token.replaceAll('"', '""')}"${token.length >= 4 ? "*" : ""}`).join(" OR ")
    : null;
}

function getCandidate(candidates: Map<string, Candidate>, row: ItemRow): Candidate {
  let candidate = candidates.get(row.id);
  if (!candidate) {
    candidate = { row, score: 0, matchedFields: new Set<string>() };
    candidates.set(row.id, candidate);
  }
  return candidate;
}

function addMatchedFields(candidate: Candidate, row: ItemRow, tokens: string[]): void {
  const fields: Array<[string, string, number]> = [
    ["key", row.key, 0.25],
    ["labels", parseLabels(row.labels_json).join(" "), 0.2],
    ["description", row.description ?? "", 0.12],
    ["searchable_text", row.searchable_text, 0.1],
  ];
  const hitTokens = new Set<string>();
  for (const [name, value, weight] of fields) {
    const normalized = normalizeText(value);
    const matches = tokens.filter((token) => normalized.includes(token));
    if (matches.length) {
      candidate.matchedFields.add(name);
      candidate.score += weight;
      for (const token of matches) hitTokens.add(token);
    }
  }
  const coverage = hitTokens.size / Math.max(tokens.length, 1);
  candidate.score += 0.8 * coverage;
  if (tokens.length > 1 && hitTokens.size === tokens.length) candidate.score += 0.25;
}

function detectShapes(text: string): { phone: boolean; email: boolean; url: boolean } {
  return { phone: PHONE_PATTERN.test(text), email: EMAIL_PATTERN.test(text), url: URL_PATTERN.test(text) };
}

function requestedShapeColumns(query: string): Array<{ column: "has_phone" | "has_email" | "has_url"; field: string }> {
  const normalized = normalizeText(query);
  const matches: Array<{ column: "has_phone" | "has_email" | "has_url"; field: string }> = [];
  if (/\b(phone|number|telephone)\b/.test(normalized)) matches.push({ column: "has_phone", field: "phone_shape" });
  if (/\b(email|e-mail)\b/.test(normalized)) matches.push({ column: "has_email", field: "email_shape" });
  if (/\b(url|link|website)\b/.test(normalized)) matches.push({ column: "has_url", field: "url_shape" });
  return matches;
}

function sqlOrder(sort: SearchObjectsInput["sort"]): string {
  switch (sort) {
    case "created_asc": return "i.created_at ASC, i.key ASC";
    case "updated_desc": return "i.updated_at DESC, i.key ASC";
    case "updated_asc": return "i.updated_at ASC, i.key ASC";
    case "due_asc": return "i.due_at IS NULL, i.due_at ASC, i.key ASC";
    case "created_desc":
    case "relevance":
    default: return "i.created_at DESC, i.key ASC";
  }
}

interface ListCursor { v: 1; createdAt: string; key: string }

function encodeCursor(createdAt: string, key: string): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, key } satisfies ListCursor)).toString("base64url");
}

function decodeCursor(cursor: string): ListCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ListCursor>;
    if (value.v !== 1 || typeof value.createdAt !== "string" || typeof value.key !== "string") throw new Error();
    normalizeTimestamp(value.createdAt, "cursor.createdAt");
    validateKey(value.key);
    return value as ListCursor;
  } catch {
    throw new Error("cursor is invalid or unsupported");
  }
}

function sortCandidates(candidates: Candidate[], sort: SearchObjectsInput["sort"]): Candidate[] {
  return candidates.sort((a, b) => {
    switch (sort) {
      case "created_asc":
        return compareStrings(a.row.created_at, b.row.created_at) || compareStrings(a.row.key, b.row.key);
      case "updated_desc":
        return compareStrings(b.row.updated_at, a.row.updated_at) || compareStrings(a.row.key, b.row.key);
      case "updated_asc":
        return compareStrings(a.row.updated_at, b.row.updated_at) || compareStrings(a.row.key, b.row.key);
      case "due_asc":
        return compareNullableDates(a.row.due_at, b.row.due_at) || compareStrings(a.row.key, b.row.key);
      case "created_desc":
        return compareStrings(b.row.created_at, a.row.created_at) || compareStrings(a.row.key, b.row.key);
      case "relevance":
      default:
        return b.score - a.score || compareStrings(b.row.updated_at, a.row.updated_at) || compareStrings(a.row.key, b.row.key);
    }
  });
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function compareNullableDates(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStrings(a, b);
}

function candidateToResult(candidate: Candidate): SearchResult {
  return {
    ...toMetadata(rowToObject(candidate.row)),
    match: {
      score: Number((1 - Math.exp(-candidate.score)).toFixed(3)),
      matchedFields: [...candidate.matchedFields].sort(),
      snippet: makeSnippet(candidate.row.searchable_text),
    },
  };
}

function makeSnippet(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length <= 180 ? clean : `${clean.slice(0, 177)}...`;
}
