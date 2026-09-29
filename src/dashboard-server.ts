import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";

import { AgentStore } from "./store.js";
import { OBJECT_KINDS, type ObjectKind, type PutObjectInput, type SearchSort } from "./types.js";
import { bindHost, databasePath as configuredDatabasePath, portNumber } from "./config.js";

const databasePath = configuredDatabasePath();
const port = portNumber(process.env.AGENTSTORE_DASHBOARD_PORT ?? process.env.PORT, 4310);
const host = bindHost(process.env.AGENTSTORE_DASHBOARD_HOST);
const store = new AgentStore(databasePath);
// Both source execution and dist/src execution work from any client working directory.
const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(moduleDirectory, basename(dirname(moduleDirectory)) === "dist" ? "../../web" : "../web");
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

const server = createServer(async (request, response) => {
  if (!validateHost(request, response) || !validateOrigin(request, response)) return;
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    sendJson(response, 400, { error: message });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(`SimpleAgentStore dashboard: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`);
  console.log(`Database: ${databasePath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, databasePath });
    return;
  }

  if (method === "GET" && url.pathname === "/api/stats") {
    sendJson(response, 200, {
      ...store.stats(),
      database: databasePath.split("/").at(-1),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/objects") {
    const completed = optionalBoolean(url.searchParams.get("completed"));
    const page = store.listPage({
      kind: optionalKinds(url.searchParams.getAll("kind")),
      sourceClient: optionalStrings(url.searchParams.getAll("source_client")),
      labels: optionalStrings(url.searchParams.getAll("label")),
      dueBefore: optionalString(url.searchParams.get("due_before")),
      completed,
      cursor: optionalString(url.searchParams.get("cursor")),
      limit: optionalNumber(url.searchParams.get("limit")),
    });
    sendJson(response, 200, {
      results: page.objects,
      count: page.objects.length,
      totalCount: page.totalCount,
      nextCursor: page.nextCursor,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/search") {
    const body = await readJson(request);
    const results = store.search({
      query: optionalString(body.query),
      kind: optionalKinds(body.kind),
      sourceClient: optionalStrings(body.sourceClient),
      labels: optionalStrings(body.labels),
      createdAfter: optionalString(body.createdAfter),
      createdBefore: optionalString(body.createdBefore),
      updatedAfter: optionalString(body.updatedAfter),
      updatedBefore: optionalString(body.updatedBefore),
      dueAfter: optionalString(body.dueAfter),
      dueBefore: optionalString(body.dueBefore),
      completed: typeof body.completed === "boolean" ? body.completed : undefined,
      keyPrefix: optionalString(body.keyPrefix),
      sort: optionalSort(body.sort),
      limit: optionalNumber(body.limit),
    });
    sendJson(response, 200, { results, count: results.length });
    return;
  }

  if (method === "POST" && url.pathname === "/api/objects") {
    const body = await readJson(request);
    const input: PutObjectInput = {
      key: requiredString(body.key, "key"),
      kind: requiredKind(body.kind),
      value: requiredObject(body.value, "value"),
      searchableText: requiredString(body.searchableText, "searchableText"),
      description: optionalString(body.description),
      labels: optionalStrings(body.labels),
      sourceClient: optionalString(body.sourceClient),
      dueAt: optionalString(body.dueAt),
      startAt: optionalString(body.startAt),
      endAt: optionalString(body.endAt),
      completed: typeof body.completed === "boolean" ? body.completed : null,
      expiresAt: optionalString(body.expiresAt),
    };
    sendJson(response, 201, { object: store.put(input) });
    return;
  }

  const objectKey = matchObjectKey(url.pathname);
  if (objectKey && method === "GET") {
    const object = store.get(objectKey);
    if (!object) {
      sendJson(response, 404, { error: "Object not found" });
    } else {
      sendJson(response, 200, { object });
    }
    return;
  }

  if (objectKey && method === "DELETE") {
    sendJson(response, 200, { key: objectKey, deleted: store.delete(objectKey) });
    return;
  }

  if (method === "GET" && staticFiles.has(url.pathname)) {
    const filename = staticFiles.get(url.pathname)!;
    const content = readFileSync(resolve(webRoot, filename));
    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Content-Length": content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON body must be an object");
  return value as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function contentType(filename: string): string {
  switch (extname(filename)) {
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    default: return "text/html; charset=utf-8";
  }
}

function matchObjectKey(pathname: string): string | null {
  const match = pathname.match(/^\/api\/objects\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function optionalKinds(value: unknown): ObjectKind[] | undefined {
  const values = optionalStrings(value);
  if (!values) return undefined;
  const kinds = values.filter((item): item is ObjectKind => OBJECT_KINDS.includes(item as ObjectKind));
  return kinds.length ? kinds : undefined;
}

function requiredKind(value: unknown): ObjectKind {
  if (typeof value !== "string" || !OBJECT_KINDS.includes(value as ObjectKind)) throw new Error("kind is invalid");
  return value as ObjectKind;
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be a JSON object`);
  return value as Record<string, unknown>;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalBoolean(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalSort(value: unknown): SearchSort | undefined {
  const sorts: SearchSort[] = ["relevance", "created_desc", "created_asc", "updated_desc", "updated_asc", "due_asc"];
  return typeof value === "string" && sorts.includes(value as SearchSort) ? value as SearchSort : undefined;
}
