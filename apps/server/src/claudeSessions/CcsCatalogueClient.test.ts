// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CcsCatalogueClient,
  CcsCatalogueClientConfig,
  CcsCatalogueClientLive,
} from "./CcsCatalogueClient.ts";

const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const servers: NodeHttp.Server[] = [];
const socketPaths: string[] = [];
const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

const sourceStatus = {
  generation: 1,
  phase: "idle",
  freshness: "fresh",
  indexedAt: "2026-07-22T12:00:00.000Z",
  refreshedAt: "2026-07-22T12:00:00.000Z",
  ageMs: 5,
  staleAfterMs: 5_000,
  rowCount: 1,
  lastError: null,
  lastRefresh: { scanned: 1, parsed: 1, skipped: 0, removed: 0 },
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(socketPaths.splice(0).map((path) => NodeFSP.rm(path, { force: true })));
});

async function listen(
  responder: (request: NodeHttp.IncomingMessage, body: string) => object,
): Promise<string> {
  const socketPath = NodePath.join(
    NodeOS.tmpdir(),
    `t3-ccs-catalogue-${process.pid}-${socketPaths.length}.sock`,
  );
  await NodeFSP.rm(socketPath, { force: true });
  const server = NodeHttp.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(encodeJson(responder(request, Buffer.concat(chunks).toString("utf8"))));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  servers.push(server);
  socketPaths.push(socketPath);
  return socketPath;
}

function makeRuntime(socketPath: string) {
  return ManagedRuntime.make(
    CcsCatalogueClientLive.pipe(
      Layer.provide(
        Layer.succeed(CcsCatalogueClientConfig, {
          socketPath,
          binary: "ccs",
          autoStart: false,
          requestTimeoutMs: 1_000,
        }),
      ),
    ),
  );
}

describe("CcsCatalogueClient", () => {
  it("uses HTTP/JSON over the configured Unix socket", async () => {
    let requestPath = "";
    let requestBody: object = {};
    const socketPath = await listen((request, body) => {
      requestPath = request.url ?? "";
      requestBody = decodeJson(body) as object;
      return {
        protocolVersion: 1,
        sessions: [
          {
            providerInstanceId: "claudeAgent",
            localSourceHost: "test-host",
            nativeSessionId,
            sourceCwd: "/workspace/project",
            projectRoot: "/workspace/project",
            projectName: "project",
            title: "Indexed title",
            titleSource: "native",
            branch: null,
            firstActivityAt: null,
            latestActivityAt: "2026-07-22T12:00:00.000Z",
            messageCount: 2,
            observedSize: 512,
            observedMtimeMs: 1_753_185_600_000,
          },
        ],
        nextCursor: "next",
        sourceStatus,
      };
    });
    const runtime = makeRuntime(socketPath);

    try {
      const client = await runtime.runPromise(Effect.service(CcsCatalogueClient));
      const page = await runtime.runPromise(
        client.queryRootSessions({ query: "indexed", limit: 25, cursor: "cursor-1" }),
      );

      expect(requestPath).toBe("/v1/root-sessions/query");
      expect(requestBody).toEqual({ query: "indexed", limit: 25, cursor: "cursor-1" });
      expect(page.protocolVersion).toBe(1);
      expect(page.nextCursor).toBe("next");
      expect(page.sessions[0]?.nativeSessionId).toBe(nativeSessionId);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects incompatible protocol versions", async () => {
    const socketPath = await listen(() => ({
      protocolVersion: 2,
      sessions: [],
      nextCursor: null,
      sourceStatus,
    }));
    const runtime = makeRuntime(socketPath);

    try {
      const client = await runtime.runPromise(Effect.service(CcsCatalogueClient));
      const error = await runtime.runPromise(Effect.flip(client.queryRootSessions({})));
      expect(error.operation).toBe("protocol");
      expect(error.code).toBe("protocol_error");
    } finally {
      await runtime.dispose();
    }
  });
});
