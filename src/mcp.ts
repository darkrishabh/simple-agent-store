import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { AgentStore, toMetadata } from "./store.js";
import { OBJECT_KINDS } from "./types.js";
import { databasePath } from "./config.js";

const kindSchema = z.enum(OBJECT_KINDS);
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Must be a valid ISO-8601 timestamp",
});

const putSchema = z.object({
  key: z.string().min(1).max(200).describe("Concise, stable identifier chosen by the writing agent."),
  kind: kindSchema.describe("Behavioral intent. Contacts should normally use reference."),
  value: z.record(z.string(), z.unknown()).describe("The original arbitrary user payload as a JSON object."),
  searchable_text: z
    .string()
    .min(1)
    .describe("Plain text preserving the important original wording for lexical retrieval."),
  description: z.string().optional(),
  labels: z.array(z.string()).max(50).optional(),
  source_client: z.string().optional(),
  due_at: timestampSchema.optional(),
  start_at: timestampSchema.optional(),
  end_at: timestampSchema.optional(),
  completed: z.boolean().optional(),
  expires_at: timestampSchema.optional().describe("Optional logical expiration timestamp."),
});

const searchSchema = z.object({
  query: z.string().optional(),
  kind: z.array(kindSchema).optional(),
  source_client: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional().describe("Exact labels; every supplied label must match."),
  created_after: timestampSchema.optional(),
  created_before: timestampSchema.optional(),
  updated_after: timestampSchema.optional(),
  updated_before: timestampSchema.optional(),
  due_after: timestampSchema.optional(),
  due_before: timestampSchema.optional(),
  completed: z.boolean().optional(),
  key_prefix: z.string().optional(),
  sort: z
    .enum(["relevance", "created_desc", "created_asc", "updated_desc", "updated_asc", "due_asc"])
    .optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const listSchema = z.object({
  kind: z.array(kindSchema).optional(),
  source_client: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  due_before: timestampSchema.optional(),
  completed: z.boolean().optional(),
  cursor: z.string().optional().describe("Opaque cursor returned by the previous list_objects page."),
  limit: z.number().int().min(1).max(100).optional(),
});

export const MCP_SERVER_INSTRUCTIONS =
  "When the user explicitly asks to save, store, remember, preserve, or keep information for later, call store_object and never claim success unless it succeeds. For requests such as all notes, todos, dates, kinds, or completion state, use list_objects with structured filters and follow next_cursor until null. For topical retrieval, call search_objects, then get_object for the full value. If discovery is thin or misses, retry with a shorter entity/category query or close synonyms; keep natural-language interpretation in the agent and deterministic execution in the store. When the user names an entity and a shape such as phone or email, include the entity in query rather than searching only for the shape.";

export function createAgentStoreServer(databasePath: string, sharedStore?: AgentStore): McpServer {
  const store = sharedStore ?? new AgentStore(databasePath);
  const server = new McpServer(
    { name: "simpleagentstore", version: "0.3.0" },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    "store_object",
    {
      description:
        "Use this whenever the user explicitly asks to save, store, remember, preserve, or keep information for later. Preserve original information and wording where practical; do not summarize away important details. Choose a concise stable key, choose kind by behavioral intent, add useful entity/category labels, and never invent facts. Do not claim success unless this tool succeeds.",
      inputSchema: putSchema,
      // Upsert replaces the existing value and increments its version on every call.
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) =>
      asToolResult(() => ({
        object: toMetadata(
          store.put({
            key: input.key,
            kind: input.kind,
            value: input.value,
            searchableText: input.searchable_text,
            description: input.description,
            labels: input.labels,
            sourceClient: input.source_client,
            dueAt: input.due_at,
            startAt: input.start_at,
            endAt: input.end_at,
            completed: input.completed,
            expiresAt: input.expires_at,
          }),
        ),
      })),
  );

  server.registerTool(
    "get_object",
    {
      description: "Retrieve the full object by exact key, normally after search_objects identifies a candidate.",
      inputSchema: z.object({ key: z.string().min(1).max(200) }),
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => asToolResult(() => ({ object: store.get(key) })),
  );

  server.registerTool(
    "search_objects",
    {
      description:
        "Search lightweight object candidates without returning full values. Translate dates and intent into explicit filters. Use query for topical/entity discovery and structured fields for kind, source, dates, completion, labels, and key prefix. If results are thin, retry with a shorter query or close entity/category synonyms. If the user names an entity plus phone/email/link, include the entity token. Follow with get_object for selected candidates.",
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      asToolResult(() => {
        const results = store.search({
          query: input.query,
          kind: input.kind,
          sourceClient: input.source_client,
          labels: input.labels,
          createdAfter: input.created_after,
          createdBefore: input.created_before,
          updatedAfter: input.updated_after,
          updatedBefore: input.updated_before,
          dueAfter: input.due_after,
          dueBefore: input.due_before,
          completed: input.completed,
          keyPrefix: input.key_prefix,
          sort: input.sort,
          limit: input.limit,
        });
        return { results, count: results.length };
      }),
  );

  server.registerTool(
    "list_objects",
    {
      description: "List object metadata with deterministic structured filters. total_count is the full filtered count. For requests such as all notes or all todos, if next_cursor is not null, copy it exactly into cursor on the next call; a call without cursor repeats page one. Continue until next_cursor is null. Full values are omitted; call get_object for selected keys.",
      inputSchema: listSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      asToolResult(() => {
        const page = store.listPage({
          kind: input.kind,
          sourceClient: input.source_client,
          labels: input.labels,
          dueBefore: input.due_before,
          completed: input.completed,
          cursor: input.cursor,
          limit: input.limit,
        });
        return {
          next_cursor: page.nextCursor,
          total_count: page.totalCount,
          count: page.objects.length,
          results: page.objects.map(compactObject),
        };
      }),
  );

  server.registerTool(
    "delete_object",
    {
      description: "Permanently delete one object by exact key.",
      inputSchema: z.object({ key: z.string().min(1).max(200) }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ key }) => asToolResult(() => ({ key, deleted: store.delete(key) })),
  );

  return server;
}

function asToolResult(run: () => Record<string, unknown>) {
  try {
    const result = run();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

function compactObject<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null)) as Partial<T>;
}

const directEntryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntryPath === fileURLToPath(import.meta.url)) {
  const path = databasePath();
  void serveStdio(() => createAgentStoreServer(path));
}
