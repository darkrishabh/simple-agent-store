import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { startAgentStoreHttpServer, type RunningAgentStoreHttpServer } from "../src/mcp-http.js";

describe("Streamable HTTP MCP adapter", () => {
  const bearerToken = "integration-test-token";
  let client: Client | undefined;
  let running: RunningAgentStoreHttpServer | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await client?.close();
    await running?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("serves the five tools and persists through the shared object store", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-http-mcp-"));
    running = await startAgentStoreHttpServer({
      bearerToken,
      databasePath: join(directory, "test.sqlite"),
      port: 0,
    });

    client = new Client({ name: "agentstore-http-test", version: "0.1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(running.url), {
        requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
      }),
    );

    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(client.getServerVersion()).toMatchObject({ name: pkg.name, version: pkg.version });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "delete_object",
      "get_object",
      "list_objects",
      "search_objects",
      "store_object",
    ]);

    const stored = await client.callTool({
      name: "store_object",
      arguments: {
        key: "http-round-trip",
        kind: "note",
        value: { text: "Saved over Streamable HTTP." },
        searchable_text: "Saved over Streamable HTTP.",
        labels: ["transport-test"],
        source_client: "integration-test",
      },
    });
    expect(stored.isError).not.toBe(true);

    const found = await client.callTool({
      name: "get_object",
      arguments: { key: "http-round-trip" },
    });
    expect(JSON.stringify(found.structuredContent)).toContain("Saved over Streamable HTTP.");
  });

  it("rejects unauthenticated MCP requests when a bearer token is configured", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-http-auth-"));
    running = await startAgentStoreHttpServer({
      bearerToken,
      databasePath: join(directory, "test.sqlite"),
      port: 0,
    });

    const response = await fetch(running.url, { method: "POST" });
    expect(response.status).toBe(401);
    const wrongToken = await fetch(running.url, { method: "POST", headers: { Authorization: "Bearer wrong" } });
    expect(wrongToken.status).toBe(401);
    expect((await fetch(new URL("/health", running.url))).status).toBe(200);
  });

  it("retains host and origin validation with container binding", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-http-host-"));
    running = await startAgentStoreHttpServer({ databasePath: join(directory, "test.sqlite"), port: 0, host: "0.0.0.0" });
    // Node fetch rewrites Host; use a raw HTTP client for the rebinding check.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(running!.url, { headers: { Host: "attacker.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect((await fetch(running.url, { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await fetch(new URL("/health", running.url))).status).toBe(200);
  });

  it("retrieves saved values and FTS candidates after an HTTP server restart", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-http-restart-"));
    const databasePath = join(directory, "persist.sqlite");
    running = await startAgentStoreHttpServer({ databasePath, port: 0, bearerToken: "" });
    client = new Client({ name: "writer", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url)));
    await client.callTool({ name: "store_object", arguments: {
      key: "persistent-note", kind: "note", value: { text: "orchid launch checklist" }, searchable_text: "orchid launch checklist",
    } });
    await client.close();
    await running.close();
    running = await startAgentStoreHttpServer({ databasePath, port: 0, bearerToken: "" });
    client = new Client({ name: "reader", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url)));
    const found = await client.callTool({ name: "search_objects", arguments: { query: "orchid" } });
    const results = (found.structuredContent as { results: Array<Record<string, unknown>> }).results;
    expect(results[0].key).toBe("persistent-note");
    expect(results[0]).not.toHaveProperty("value");
    const full = await client.callTool({ name: "get_object", arguments: { key: "persistent-note" } });
    expect(full.structuredContent).toMatchObject({ object: { value: { text: "orchid launch checklist" } } });
  });
});
