import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentStore } from "../src/store.js";

describe("native dashboard configuration", () => {
  let child: ChildProcess | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("serves assets from another cwd and writes to the configured SQLite file", async () => {
    directory = mkdtempSync(join(tmpdir(), "agentstore-dashboard-"));
    const path = join(directory, "custom.sqlite");
    child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("src/dashboard-server.ts")], {
      cwd: directory,
      env: { ...process.env, AGENTSTORE_DB_PATH: path, AGENTSTORE_DASHBOARD_HOST: "127.0.0.1", AGENTSTORE_DASHBOARD_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = await new Promise<string>((resolveUrl, reject) => {
      let output = "";
      let errors = "";
      const timeout = setTimeout(() => reject(new Error(`Dashboard startup timed out: ${errors}`)), 10_000);
      child!.stderr!.on("data", (chunk) => { errors += String(chunk); });
      child!.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolveUrl(match[0]); }
      });
      child!.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child!.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Dashboard exited (${code}): ${errors}`)); });
    });
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>SimpleAgentStore Dashboard</title>");
    expect((await fetch(`${url}/app.js`)).status).toBe(200);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect((await fetch(`${url}/api/stats`, { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    const saved = await fetch(`${url}/api/objects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "native-note", kind: "note", value: { text: "custom file" }, searchableText: "custom file" }),
    });
    expect(saved.status).toBe(201);
    const store = new AgentStore(path);
    try { expect(store.get("native-note")?.value).toEqual({ text: "custom file" }); } finally { store.close(); }
  });
});
