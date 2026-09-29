import { timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createAgentStoreServer } from "./mcp.js";
import { AgentStore } from "./store.js";
import { bindHost, databasePath as configuredDatabasePath, portNumber } from "./config.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4311;

export interface AgentStoreHttpOptions {
  bearerToken?: string;
  databasePath?: string;
  port?: number;
  host?: string;
}

export interface RunningAgentStoreHttpServer {
  url: string;
  close: () => Promise<void>;
}

export async function startAgentStoreHttpServer(
  options: AgentStoreHttpOptions = {},
): Promise<RunningAgentStoreHttpServer> {
  const databasePath = options.databasePath ?? configuredDatabasePath();
  const port = options.port ?? DEFAULT_PORT;
  const host = bindHost(options.host);
  const bearerToken = options.bearerToken ?? process.env.AGENTSTORE_MCP_TOKEN;
  const store = new AgentStore(databasePath);
  const handler = createMcpHandler(() => createAgentStoreServer(databasePath, store), {
    responseMode: "json",
  });
  const handleMcp = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;

    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`);
    if (requestUrl.pathname === "/health" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok", service: "simpleagentstore-mcp" }));
      return;
    }

    if (requestUrl.pathname !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (bearerToken && !hasValidBearerToken(request.headers.authorization, bearerToken)) {
      response.writeHead(401, {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": "Bearer",
      });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    void handleMcp(request, response).catch((error: unknown) => {
      console.error("SimpleAgentStore MCP request failed", error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      if (!response.writableEnded) response.end(JSON.stringify({ error: "Internal server error" }));
    });
  });

  try {
    await listen(httpServer, port, host);
  } catch (error) {
    await handler.close();
    store.close();
    throw error;
  }
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await closeHttpServer(httpServer);
    store.close();
    throw new Error("SimpleAgentStore HTTP server did not expose a TCP address");
  }

  let closed = false;
  return {
    url: `http://${DEFAULT_HOST}:${address.port}/mcp`,
    close: async () => {
      if (closed) return;
      closed = true;
      await handler.close();
      await closeHttpServer(httpServer);
      store.close();
    },
  };
}

function hasValidBearerToken(authorization: string | undefined, bearerToken: string): boolean {
  const expected = Buffer.from(`Bearer ${bearerToken}`);
  const actual = Buffer.from(authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

const directEntryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (directEntryPath === fileURLToPath(import.meta.url)) {
  const databasePath = configuredDatabasePath();
  const parsedPort = portNumber(process.env.AGENTSTORE_MCP_PORT, DEFAULT_PORT);

  const running = await startAgentStoreHttpServer({
    bearerToken: process.env.AGENTSTORE_MCP_TOKEN,
    databasePath,
    port: parsedPort,
    host: process.env.AGENTSTORE_MCP_HOST,
  });
  console.log(`SimpleAgentStore MCP listening at ${running.url}`);
  console.log(`Database: ${databasePath}`);

  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
