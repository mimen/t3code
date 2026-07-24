// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION,
  ClaudeSessionCatalogEntry,
  ClaudeSessionCatalogueSourceStatus,
  TrimmedNonEmptyString,
  type ClaudeSessionCatalogueQuery,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const START_TIMEOUT_MS = 5_000;
const START_POLL_INTERVAL_MS = 25;

const CcsCatalogueProtocolPage = Schema.Struct({
  protocolVersion: Schema.Literal(CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION),
  sessions: Schema.Array(ClaudeSessionCatalogEntry),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  sourceStatus: ClaudeSessionCatalogueSourceStatus,
});
export type CcsCatalogueProtocolPage = typeof CcsCatalogueProtocolPage.Type;

const CcsVerifiedCatalogueSource = Schema.Struct({
  ...ClaudeSessionCatalogEntry.fields,
  sourcePath: TrimmedNonEmptyString,
  fileIdentity: TrimmedNonEmptyString,
});
export type CcsVerifiedCatalogueSource = typeof CcsVerifiedCatalogueSource.Type;

const CcsCatalogueSourceLookupResult = Schema.Struct({
  protocolVersion: Schema.Literal(CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION),
  source: CcsVerifiedCatalogueSource,
  sourceStatus: ClaudeSessionCatalogueSourceStatus,
});
export type CcsCatalogueSourceLookupResult = typeof CcsCatalogueSourceLookupResult.Type;

const CcsCatalogueProtocolError = Schema.Struct({
  protocolVersion: Schema.Literal(CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION),
  error: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  }),
});

const encodeJsonString = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);
const decodeCatalogueProtocolPage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CcsCatalogueProtocolPage),
);
const decodeCatalogueSourceLookupResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CcsCatalogueSourceLookupResult),
);
const decodeCatalogueProtocolError = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CcsCatalogueProtocolError),
);

export class CcsCatalogueClientError extends Schema.TaggedErrorClass<CcsCatalogueClientError>()(
  "CcsCatalogueClientError",
  {
    operation: Schema.Literals(["query", "lookup", "start", "transport", "protocol"]),
    code: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `CCS catalogue ${this.operation} (${this.code}): ${this.detail}`;
  }
}

export interface CcsCatalogueClientShape {
  readonly queryRootSessions: (
    query: ClaudeSessionCatalogueQuery,
  ) => Effect.Effect<CcsCatalogueProtocolPage, CcsCatalogueClientError>;
  readonly lookupSource: (input: {
    readonly resumeId: string;
    readonly cwd: string;
  }) => Effect.Effect<CcsCatalogueSourceLookupResult, CcsCatalogueClientError>;
}

export class CcsCatalogueClient extends Context.Service<
  CcsCatalogueClient,
  CcsCatalogueClientShape
>()("t3/claudeSessions/CcsCatalogueClient") {}

interface CcsCatalogueClientConfigShape {
  readonly socketPath: string;
  readonly binary: string;
  readonly autoStart: boolean;
  readonly requestTimeoutMs: number;
}

export class CcsCatalogueClientConfig extends Context.Service<
  CcsCatalogueClientConfig,
  CcsCatalogueClientConfigShape
>()("t3/claudeSessions/CcsCatalogueClient/CcsCatalogueClientConfig") {}

interface UnixHttpResponse {
  readonly status: number;
  readonly body: string;
}

function clientError(
  operation: CcsCatalogueClientError["operation"],
  code: string,
  detail: string,
  cause?: object,
): CcsCatalogueClientError {
  return new CcsCatalogueClientError({
    operation,
    code,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function runtimeRoot(): string {
  const configured = process.env.CCS_ROOT?.trim();
  return configured && configured.length > 0
    ? configured
    : NodePath.join(process.env.HOME ?? NodeOS.homedir(), ".ccs");
}

export function defaultCcsCatalogueSocketPath(): string {
  const configured = process.env.CCS_CATALOGUE_SOCKET?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  const root = runtimeRoot();
  const preferred = NodePath.join(root, "run", "native-catalogue-v1.sock");
  if (Buffer.byteLength(preferred) < 100) {
    return preferred;
  }
  const digest = NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return NodePath.join(NodeOS.tmpdir(), `ccs-catalogue-${uid}-${digest}.sock`);
}

export function CcsCatalogueClientConfigLive(): Layer.Layer<CcsCatalogueClientConfig> {
  const configuredBinary = process.env.CCS_BIN?.trim();
  return Layer.succeed(CcsCatalogueClientConfig, {
    socketPath: defaultCcsCatalogueSocketPath(),
    binary: configuredBinary && configuredBinary.length > 0 ? configuredBinary : "ccs",
    autoStart: process.env.NODE_ENV !== "test" && process.env.VITEST !== "true",
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });
}

function requestUnixHttp(
  socketPath: string,
  path: string,
  options: {
    readonly method: "GET" | "POST";
    readonly body?: string;
    readonly timeoutMs: number;
  },
): Promise<UnixHttpResponse> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = NodeHttp.request(
      {
        socketPath,
        path,
        method: options.method,
        headers:
          options.body === undefined
            ? undefined
            : {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(options.body)),
              },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          responseBytes += buffer.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("CCS catalogue response exceeded 4 MiB."));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    // @effect-diagnostics-next-line globalTimers:off -- Node's HTTP callback API requires an imperative timeout.
    timeout = setTimeout(() => {
      request.destroy(new Error("CCS catalogue request timed out."));
    }, options.timeoutMs);
    request.on("error", (cause: Error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(cause);
    });
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

function startCatalogueService(binary: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = NodeChildProcess.spawn(binary, ["catalogue-service", "start"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

const ensureCatalogueService = Effect.fn("CcsCatalogueClient.ensureCatalogueService")(function* (
  config: CcsCatalogueClientConfigShape,
) {
  yield* Effect.tryPromise({
    try: () => startCatalogueService(config.binary),
    catch: (cause) =>
      clientError("start", "unavailable", "Cannot start the CCS catalogue service.", { cause }),
  });

  const deadline = (yield* Clock.currentTimeMillis) + START_TIMEOUT_MS;
  while ((yield* Clock.currentTimeMillis) < deadline) {
    const response = yield* Effect.tryPromise({
      try: () =>
        requestUnixHttp(config.socketPath, "/v1/health", {
          method: "GET",
          timeoutMs: 250,
        }),
      catch: () => clientError("transport", "unavailable", "CCS catalogue is starting."),
    }).pipe(Effect.option);
    if (response._tag === "Some" && response.value.status >= 200 && response.value.status < 300) {
      return;
    }
    yield* Effect.sleep(Duration.millis(START_POLL_INTERVAL_MS));
  }

  return yield* clientError(
    "start",
    "unavailable",
    "CCS catalogue service did not become ready within 5 seconds.",
  );
});

const makeCcsCatalogueClient = Effect.gen(function* () {
  const config = yield* CcsCatalogueClientConfig;

  const requestJson = <A>(input: {
    readonly operation: "query" | "lookup";
    readonly path: string;
    readonly body: object;
    readonly decode: (body: string) => Effect.Effect<A, Schema.SchemaError>;
  }): Effect.Effect<A, CcsCatalogueClientError> =>
    Effect.gen(function* () {
      const body = yield* encodeJsonString(input.body).pipe(
        Effect.mapError((cause) =>
          clientError("protocol", "protocol_error", "Cannot encode the CCS request body.", {
            cause,
          }),
        ),
      );
      const execute = Effect.tryPromise({
        try: () =>
          requestUnixHttp(config.socketPath, input.path, {
            method: "POST",
            body,
            timeoutMs: config.requestTimeoutMs,
          }),
        catch: (cause) =>
          clientError("transport", "unavailable", "CCS catalogue service is unavailable.", {
            cause,
          }),
      });

      let response = yield* execute.pipe(Effect.option);
      if (response._tag === "None" && config.autoStart) {
        yield* ensureCatalogueService(config);
        response = yield* execute.pipe(Effect.option);
      }
      if (response._tag === "None") {
        return yield* clientError(
          "transport",
          "unavailable",
          "CCS catalogue service is unavailable.",
        );
      }

      if (response.value.status < 200 || response.value.status >= 300) {
        const protocolError = yield* decodeCatalogueProtocolError(response.value.body).pipe(
          Effect.mapError((cause) =>
            clientError("protocol", "protocol_error", "CCS returned an invalid error envelope.", {
              cause,
            }),
          ),
        );
        return yield* clientError(
          input.operation,
          protocolError.error.code,
          protocolError.error.message,
        );
      }

      return yield* input
        .decode(response.value.body)
        .pipe(
          Effect.mapError((cause) =>
            clientError(
              "protocol",
              "protocol_error",
              "CCS returned an incompatible catalogue response.",
              { cause },
            ),
          ),
        );
    });

  const queryRootSessions: CcsCatalogueClientShape["queryRootSessions"] = (query) =>
    requestJson({
      operation: "query",
      path: "/v1/root-sessions/query",
      body: query,
      decode: decodeCatalogueProtocolPage,
    });

  const lookupSource: CcsCatalogueClientShape["lookupSource"] = (input) =>
    requestJson({
      operation: "lookup",
      path: "/v1/source/lookup",
      body: input,
      decode: decodeCatalogueSourceLookupResult,
    });

  return { queryRootSessions, lookupSource } satisfies CcsCatalogueClientShape;
});

export const CcsCatalogueClientLive = Layer.effect(CcsCatalogueClient, makeCcsCatalogueClient);

export const CcsCatalogueClientConfiguredLive = CcsCatalogueClientLive.pipe(
  Layer.provide(CcsCatalogueClientConfigLive()),
);
