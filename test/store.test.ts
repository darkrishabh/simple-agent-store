import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentStore } from "../src/store.js";

describe("AgentStore", () => {
  let store: AgentStore;

  beforeEach(() => {
    store = new AgentStore();
  });

  afterEach(() => {
    store.close();
  });

  it("creates an object", () => {
    const object = putFixture(store);
    expect(object.key).toBe("mike-plumber-contact");
    expect(object.version).toBe(1);
  });

  it("updates the same key and increments its version", () => {
    const first = putFixture(store);
    const second = putFixture(store, {
      searchableText: "Mike now handles emergency plumbing calls.",
      value: { text: "Mike now handles emergency plumbing calls." },
    });

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.searchableText).toContain("emergency");
  });

  it("get returns the full value", () => {
    putFixture(store);
    expect(store.get("mike-plumber-contact")?.value).toEqual({ phone: "415-555-0123" });
  });

  it("search finds lexical text matches", () => {
    putFixture(store);
    const results = store.search({ query: "kitchen plumber" });
    expect(results[0]?.key).toBe("mike-plumber-contact");
    expect(results[0]?.match.matchedFields).toContain("searchable_text");
  });

  it("supports prefix retrieval across text and labels", () => {
    putFixture(store, { searchableText: "Mike handles plumbing emergencies.", labels: ["contractors"] });
    expect(store.search({ query: "plumb" })[0]?.key).toBe("mike-plumber-contact");
    expect(store.search({ query: "contrac" })[0]?.key).toBe("mike-plumber-contact");
  });

  it("ranks broader query-token coverage ahead of a one-token match", () => {
    putFixture(store, {
      key: "pharmacy-pickup",
      searchableText: "Pick up medication from the pharmacy.",
      labels: ["pharmacy", "medication", "pickup"],
    });
    putFixture(store, {
      key: "school-pickup",
      searchableText: "Pick up the children from school.",
      labels: ["school", "pickup"],
    });
    expect(store.search({ query: "pharmacy medication pickup" })[0]?.key).toBe("pharmacy-pickup");
  });

  it("labels contribute to retrieval", () => {
    putFixture(store, { searchableText: "Mike's details.", description: "Service provider" });
    const results = store.search({ query: "contractor" });
    expect(results[0]?.key).toBe("mike-plumber-contact");
    expect(results[0]?.match.matchedFields).toContain("labels");
  });

  it("filters by source client", () => {
    putFixture(store);
    putFixture(store, { key: "other", sourceClient: "claude" });
    expect(store.search({ sourceClient: ["chatgpt"] }).map((item) => item.key)).toEqual([
      "mike-plumber-contact",
    ]);
  });

  it("combines lexical search with structured filters", () => {
    putFixture(store);
    putFixture(store, { key: "claude-plumber", sourceClient: "claude" });
    expect(store.search({ query: "plumber", sourceClient: ["chatgpt"] }).map((item) => item.key)).toEqual([
      "mike-plumber-contact",
    ]);
  });

  it("filters by kind", () => {
    putFixture(store);
    putFixture(store, { key: "todo", kind: "todo" });
    expect(store.search({ kind: ["todo"] }).map((item) => item.key)).toEqual(["todo"]);
  });

  it("filters by creation date", () => {
    putFixture(store, {}, "2026-08-01T12:00:00Z");
    putFixture(store, { key: "later" }, "2026-08-20T12:00:00Z");
    expect(
      store.search({
        createdAfter: "2026-08-10T00:00:00Z",
        createdBefore: "2026-09-01T00:00:00Z",
      })[0]?.key,
    ).toBe("later");
  });

  it("filters by due date", () => {
    putFixture(store, { dueAt: "2026-09-05T12:00:00Z" });
    putFixture(store, { key: "later", dueAt: "2026-10-05T12:00:00Z" });
    expect(store.search({ dueBefore: "2026-09-10T00:00:00Z" }).map((item) => item.key)).toEqual([
      "mike-plumber-contact",
    ]);
  });

  it("normalizes list date offsets just like search", () => {
    putFixture(store, { dueAt: "2026-09-05T11:00:00Z" });
    putFixture(store, { key: "later", dueAt: "2026-09-05T13:00:00Z" });
    const filter = { dueBefore: "2026-09-05T14:00:00+02:00" };
    expect(store.listPage(filter).objects.map((item) => item.key)).toEqual(["mike-plumber-contact"]);
    expect(store.listPage(filter).totalCount).toBe(1);
    expect(store.search(filter).map((item) => item.key)).toEqual(["mike-plumber-contact"]);
    expect(() => store.listPage({ dueBefore: "not-a-date" })).toThrow("dueBefore");
  });

  it("prioritizes the named contact over other phone-shaped candidates", () => {
    putFixture(store, { key: "alice-contact", searchableText: "Alice at 415-555-0999", labels: ["alice"] });
    putFixture(store);
    const results = store.search({ query: "Mike phone" });
    expect(results[0]?.key).toBe("mike-plumber-contact");
    expect(store.get(results[0]!.key)?.value.phone).toBe("415-555-0123");
  });

  it("treats SQL wildcards in key prefixes literally", () => {
    putFixture(store, { key: "notes_100%/real" });
    putFixture(store, { key: "notesX100X/decoy" });
    expect(store.search({ keyPrefix: "notes_100%/" }).map((item) => item.key)).toEqual(["notes_100%/real"]);
  });

  it("does not replace existing values when an update fails validation", () => {
    const before = putFixture(store);
    expect(() => putFixture(store, { dueAt: "invalid" })).toThrow();
    expect(store.get(before.key)).toEqual(before);
    expect(store.search({ query: "kitchen" })[0]?.key).toBe(before.key);
  });

  it("paginates combined filters across tied timestamps without leaking expired objects", () => {
    for (let i = 0; i < 7; i++) putFixture(store, { key: `todo-${i}`, kind: "todo", completed: false, labels: ["launch"] });
    putFixture(store, { key: "expired", kind: "todo", completed: false, labels: ["launch"], expiresAt: "2020-01-01T00:00:00Z" });
    putFixture(store, { key: "finished", kind: "todo", completed: true, labels: ["launch"] });
    putFixture(store, { key: "different-label", kind: "todo", completed: false, labels: ["other"] });
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = store.listPage({ kind: ["todo"], labels: ["launch"], completed: false, limit: 2, cursor });
      expect(page.totalCount).toBe(7);
      keys.push(...page.objects.map((item) => item.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(keys).toEqual(Array.from({ length: 7 }, (_, i) => `todo-${i}`));
    expect(store.stats().total).toBe(9);
  });

  it("filters by completion state", () => {
    putFixture(store, { kind: "reminder", completed: false });
    putFixture(store, { key: "done", kind: "reminder", completed: true });
    expect(store.search({ kind: ["reminder"], completed: false }).map((item) => item.key)).toEqual([
      "mike-plumber-contact",
    ]);
  });

  it("requires every explicit label filter", () => {
    putFixture(store);
    putFixture(store, { key: "mike-electrician", labels: ["mike", "electrician"] });
    expect(store.search({ labels: ["mike", "plumber"] }).map((item) => item.key)).toEqual([
      "mike-plumber-contact",
    ]);
  });

  it("list omits full values", () => {
    putFixture(store);
    const listed = store.list()[0];
    expect(listed).toBeDefined();
    expect("value" in listed!).toBe(false);
    expect("searchableText" in listed!).toBe(false);
  });

  it("paginates every object without duplicates", () => {
    for (let index = 0; index < 235; index += 1) {
      putFixture(store, { key: `object-${String(index).padStart(3, "0")}` });
    }
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = store.listPage({ limit: 37, cursor });
      expect(page.totalCount).toBe(235);
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(keys).toHaveLength(235);
    expect(new Set(keys).size).toBe(235);
  });

  it("rejects malformed cursors", () => {
    expect(() => store.listPage({ cursor: "not-a-cursor" })).toThrow("cursor is invalid");
  });

  it("reports complete statistics beyond one list page", () => {
    for (let index = 0; index < 125; index += 1) {
      putFixture(store, { key: `stat-${index}`, kind: index % 2 ? "note" : "todo" });
    }
    const stats = store.stats();
    expect(stats.total).toBe(125);
    expect(stats.byKind.note + stats.byKind.todo).toBe(125);
  });

  it("retrieves a label-only object beyond 5,000 records", () => {
    for (let index = 0; index < 5_100; index += 1) {
      putFixture(store, {
        key: `bulk-${index}`,
        searchableText: `Ordinary bulk object ${index}`,
        labels: index === 5_099 ? ["deep-archive-target"] : ["bulk"],
      });
    }
    expect(store.search({ query: "deep-archive" })[0]?.key).toBe("bulk-5099");
  }, 20_000);

  it("search omits full values", () => {
    putFixture(store);
    const result = store.search({ query: "plumber" })[0];
    expect(result).toBeDefined();
    expect("value" in result!).toBe(false);
    expect("searchableText" in result!).toBe(false);
  });

  it("deletes an object", () => {
    putFixture(store);
    expect(store.delete("mike-plumber-contact")).toBe(true);
    expect(store.get("mike-plumber-contact")).toBeNull();
    expect(store.delete("mike-plumber-contact")).toBe(false);
  });

  it("keeps FTS synchronized after update and delete", () => {
    putFixture(store);
    expect(store.search({ query: "kitchen" })).toHaveLength(1);

    putFixture(store, {
      searchableText: "Mike repairs boilers.",
      value: { text: "Mike repairs boilers." },
    });
    expect(store.search({ query: "kitchen" })).toHaveLength(0);
    expect(store.search({ query: "boilers" })[0]?.key).toBe("mike-plumber-contact");

    store.delete("mike-plumber-contact");
    expect(store.search({ query: "boilers" })).toHaveLength(0);
  });

  it("uses deterministic shape matching", () => {
    putFixture(store);
    const results = store.search({ query: "which item has a phone number" });
    expect(results[0]?.key).toBe("mike-plumber-contact");
    expect(results[0]?.match.matchedFields).toContain("phone_shape");
  });

  it("logically hides expired objects", () => {
    putFixture(store, { expiresAt: "2020-01-01T00:00:00Z" });
    expect(store.get("mike-plumber-contact")).toBeNull();
    expect(store.list()).toHaveLength(0);
    expect(store.search({ query: "plumber" })).toHaveLength(0);
  });
});

describe("AgentStore schema migration", () => {
  it("backfills indexed labels and shape columns in an existing database", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentstore-migration-"));
    const path = join(directory, "legacy.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
        value_json TEXT NOT NULL, searchable_text TEXT NOT NULL, description TEXT,
        labels_json TEXT NOT NULL DEFAULT '[]', source_client TEXT, due_at TEXT,
        start_at TEXT, end_at TEXT, completed INTEGER, expires_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL
      );
      INSERT INTO items VALUES (
        'legacy-id', 'legacy-contact', 'reference', '{"phone":"415-555-0199"}',
        'Legacy contact phone 415-555-0199', 'Imported record', '["legacy-label"]',
        'import', NULL, NULL, NULL, NULL, NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1
      );
    `);
    legacy.close();

    const migrated = new AgentStore(path);
    try {
      expect(migrated.get("legacy-contact")).toMatchObject({ id: "legacy-id", version: 1, value: { phone: "415-555-0199" }, createdAt: "2026-08-01T00:00:00.000Z" });
      expect(migrated.search({ labels: ["legacy-label"] })[0]?.key).toBe("legacy-contact");
      expect(migrated.search({ query: "phone number" })[0]?.match.matchedFields).toContain("phone_shape");
    } finally {
      migrated.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function putFixture(
  store: AgentStore,
  overrides: Partial<Parameters<AgentStore["put"]>[0]> = {},
  now = "2026-08-15T12:00:00Z",
) {
  return store.put(
    {
      key: "mike-plumber-contact",
      kind: "reference",
      value: { phone: "415-555-0123" },
      searchableText: "Mike fixed the kitchen plumbing. His number is 415-555-0123.",
      description: "Contact details for Mike",
      labels: ["mike", "plumber", "contractor", "phone"],
      sourceClient: "chatgpt",
      ...overrides,
    },
    { now },
  );
}
