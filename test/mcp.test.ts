import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

describe("MCP adapter", () => {
  let client: Client | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("exposes exactly five tools and supports search then get", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-mcp-"));
    const databasePath = join(directory, "test.sqlite");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/mcp.ts")],
      env: { ...process.env, AGENTSTORE_DB_PATH: databasePath } as Record<string, string>,
      stderr: "pipe",
    });
    client = new Client({ name: "agentstore-test", version: "0.1.0" });
    await client.connect(transport);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(client.getServerVersion()).toMatchObject({ name: pkg.name, version: pkg.version });

    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "store_object")?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
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
        key: "agentstore-rule",
        kind: "note",
        value: { text: "Deterministic query execution belongs in the store." },
        searchable_text: "Deterministic query execution belongs in the store.",
        labels: ["agentstore", "architecture"],
        source_client: "codex",
      },
    });
    expect(stored.isError).not.toBe(true);

    const search = await client.callTool({
      name: "search_objects",
      arguments: { query: "deterministic query" },
    });
    expect(JSON.stringify(search.structuredContent)).toContain("agentstore-rule");
    const searchResult = search.structuredContent as { results: Array<Record<string, unknown>> };
    expect(searchResult.results[0]).not.toHaveProperty("value");
    expect(searchResult.results[0]).not.toHaveProperty("searchableText");

    const get = await client.callTool({ name: "get_object", arguments: { key: "agentstore-rule" } });
    expect(JSON.stringify(get.structuredContent)).toContain("Deterministic query execution belongs");

    for (const key of ["page-a", "page-b", "page-c"]) {
      await client.callTool({
        name: "store_object",
        arguments: { key, kind: "note", value: { text: key }, searchable_text: key },
      });
    }
    const firstPage = await client.callTool({ name: "list_objects", arguments: { limit: 2 } });
    const firstContent = firstPage.structuredContent as { results: unknown[]; next_cursor: string | null; total_count: number };
    expect(firstContent.results).toHaveLength(2);
    expect(firstContent.total_count).toBe(4);
    expect(firstContent.next_cursor).toEqual(expect.any(String));
    const secondPage = await client.callTool({
      name: "list_objects",
      arguments: { limit: 2, cursor: firstContent.next_cursor },
    });
    const secondContent = secondPage.structuredContent as { results: unknown[]; next_cursor: string | null };
    expect(secondContent.results).toHaveLength(2);
    expect(secondContent.next_cursor).toBeNull();
  });
});
