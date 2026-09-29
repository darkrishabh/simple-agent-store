// This script creates and removes ONLY its uniquely named test stack and volume.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `agentstore-test-${randomBytes(6).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "agentstore-docker-"));
const envFile = join(directory, "empty.env");
writeFileSync(envFile, "", { mode: 0o600 });
const token = randomBytes(24).toString("hex");
const env = { ...process.env, AGENTSTORE_MCP_PORT: "0", AGENTSTORE_DASHBOARD_PORT: "0", AGENTSTORE_MCP_TOKEN: token };
const args = ["compose", "--project-name", project, "--project-directory", root, "--env-file", envFile, "-f", join(root, "compose.yaml")];
const compose = (...command) => execFileSync("docker", [...args, ...command], { cwd: root, env, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
let clients = [];
let started = false;
let endpoint;
let dashboard;

function addresses() {
  const address = (service, port) => {
    const value = compose("port", service, String(port)).trim();
    assert.match(value, /^127\.0\.0\.1:\d+$/);
    return `http://${value}`;
  };
  endpoint = `${address("mcp", 4311)}/mcp`;
  dashboard = address("dashboard", 4310);
}

async function connect(name, authenticated = true) {
  const client = new Client({ name, version: "1.0.0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} },
  }));
  return client;
}

async function call(client, name, arguments_) {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent;
}

async function closeClients() {
  await Promise.all(clients.map((client) => client.close()));
  clients = [];
}

try {
  // Check the real default separately from the isolated test's project override.
  const configEnv = { ...env };
  delete configEnv.COMPOSE_PROJECT_NAME;
  const defaultConfig = JSON.parse(execFileSync("docker", ["compose", "--project-directory", root, "--env-file", envFile, "-f", join(root, "compose.yaml"), "config", "--format", "json"], { env: configEnv, encoding: "utf8" }));
  assert.equal(defaultConfig.name, "agentstore");
  assert.equal(defaultConfig.volumes["agentstore-data"].name, "agentstore_agentstore-data");
  console.log("PASS: repository rename preserves the default Compose data volume.");
  console.log(`Building isolated Docker test stack: ${project}`);
  compose("build");
  started = true;
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  addresses();
  assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${dashboard}/`, { headers: { Origin: "https://attacker.example" } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${dashboard}/`, { headers: { Host: "attacker.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(`${dashboard}/`)).status, 200);
  assert.equal((await fetch(`${dashboard}/app.js`)).status, 200);
  assert.equal(compose("exec", "-T", "mcp", "id", "-u").trim(), "1000");

  const writer = await connect("test-writer");
  const reader = await connect("test-reader");
  assert.equal(writer.getServerVersion().name, "simpleagentstore");
  assert.equal((await writer.listTools()).tools.length, 5);
  const input = { key: "docker-note", kind: "note", value: { text: "orchid launch checklist" }, searchable_text: "orchid launch checklist", labels: ["docker-test"] };
  await call(writer, "store_object", input);
  const search = await call(reader, "search_objects", { query: "orchid" });
  assert.equal(search.results[0].key, input.key);
  assert.equal("value" in search.results[0], false);
  assert.equal((await call(reader, "get_object", { key: input.key })).object.value.text, input.value.text);
  const shown = await (await fetch(`${dashboard}/api/objects/docker-note`)).json();
  assert.equal(shown.object.value.text, input.value.text);

  const update = await fetch(`${dashboard}/api/objects`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: input.key, kind: "note", value: { text: "orchid revised checklist" }, searchableText: "orchid revised checklist" }),
  });
  assert.equal(update.status, 201);
  assert.equal((await call(reader, "get_object", { key: input.key })).object.version, 2);
  for (const key of ["page-a", "page-b", "page-c"]) {
    await call(writer, "store_object", { ...input, key });
  }
  const keys = new Set();
  let cursor;
  do {
    const page = await call(reader, "list_objects", { kind: ["note"], limit: 2, ...(cursor ? { cursor } : {}) });
    assert.equal(page.total_count, 4);
    for (const item of page.results) { assert.equal(keys.has(item.key), false); keys.add(item.key); }
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(keys.size, 4);
  console.log("PASS: real MCP CRUD, cross-client retrieval, pagination, dashboard sharing, auth and network guards.");

  await closeClients();
  compose("down"); // Keep the named volume; recreate containers to test persistence.
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  addresses();
  const reopened = await connect("test-reopened");
  assert.equal((await call(reopened, "get_object", { key: input.key })).object.value.text, "orchid revised checklist");
  assert.equal((await call(reopened, "search_objects", { query: "revised" })).results[0].key, input.key);
  const storedCount = compose("exec", "-T", "mcp", "node", "--input-type=module", "-e",
    "import Database from 'better-sqlite3'; const db = new Database('/data/agentstore.sqlite', { readonly: true }); console.log(db.prepare('SELECT count(*) AS n FROM items').get().n); db.close();");
  assert.equal(storedCount.trim(), "4");
  await call(reopened, "delete_object", { key: input.key });
  assert.equal((await fetch(`${dashboard}/api/objects/docker-note`)).status, 404);
  console.log("PASS: named-volume persistence after container recreation, FTS persistence, direct DB verification and deletion.");

  await closeClients();
  env.AGENTSTORE_MCP_TOKEN = "";
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  addresses();
  const localPlugin = await connect("test-default-plugin-connection", false);
  assert.equal((await localPlugin.listTools()).tools.length, 5);
  console.log("PASS: default unauthenticated loopback MCP connection used by bundled plugins.");
} catch (error) {
  if (started) console.error(compose("logs", "--tail", "60"));
  throw error;
} finally {
  try {
    await closeClients();
  } finally {
    try {
      if (started) {
        compose("down", "--volumes", "--remove-orphans");
        console.log(`Removed only test containers and test volume for ${project}.`);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
