// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CLAUDE_SESSION_CATALOGUE_DEFAULT_LIMIT,
  CLAUDE_SESSION_CATALOGUE_MAX_LIMIT,
  ProviderInstanceId,
  type ClaudeSessionCatalogEntry as ClaudeSessionCatalogListEntry,
  type ClaudeSessionCataloguePage,
  type ClaudeSessionCatalogueQuery,
  type ClaudeSessionPreview,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  CcsCatalogueClient,
  CcsCatalogueClientError,
  type CcsCatalogueProtocolPage,
} from "./CcsCatalogueClient.ts";
import { firstVisibleHumanText, normalizeClaudeJsonlLine } from "./ClaudeJsonlNormalizer.ts";
import {
  type ClaudeJsonlFileMetadata,
  type ClaudeJsonlReadError,
  readCompleteClaudeJsonlRecords,
} from "./ClaudeJsonlReader.ts";
import {
  readClaudeSessionPreview,
  type ClaudeSessionPreviewError,
} from "./ClaudeSessionPreview.ts";

const CATALOG_SCAN_MAX_RECORDS = 128;
const CATALOG_SCAN_MAX_BYTES = 4 * 1024 * 1024;
const DEGRADED_CATALOGUE_DISCOVERY_LIMIT = 2_000;
const DEGRADED_CATALOGUE_CANDIDATE_LIMIT = 200;
const DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const NATIVE_CLAUDE_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeSessionCatalogError extends Schema.TaggedErrorClass<ClaudeSessionCatalogError>()(
  "ClaudeSessionCatalogError",
  {
    operation: Schema.Literals([
      "claude-home",
      "projects-root",
      "source-path",
      "source-cwd",
      "source-session-id",
      "session-not-found",
      "session-ambiguous",
      "cwd-mismatch",
      "catalogue-query",
      "preview",
    ]),
    sourcePath: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Claude session catalogue ${this.operation}: ${this.detail}`;
  }
}

const isClaudeSessionCatalogError = Schema.is(ClaudeSessionCatalogError);

export interface ClaudeSessionCatalogEntry extends ClaudeJsonlFileMetadata {
  readonly nativeSessionId: string;
  readonly sourcePath: string;
  readonly sourceCwd: string;
  readonly title: string;
  readonly firstActivityAt: string | null;
  readonly latestActivityAt: string | null;
  readonly messageCount: number;
  readonly malformedRecordCount: number;
}

export interface ValidatedClaudeSessionSource extends ClaudeSessionCatalogEntry {
  readonly sourceCwd: string;
}

export class ClaudeHome extends Context.Service<
  ClaudeHome,
  {
    readonly homePath: string;
  }
>()("t3/claudeSessions/ClaudeSessionCatalog/ClaudeHome") {}

export const ClaudeHomeLive = (homePath: string) => Layer.succeed(ClaudeHome, { homePath });

export type ClaudeSessionSourceFailure = ClaudeSessionCatalogError | ClaudeJsonlReadError;
export type ClaudeSessionCatalogFailure = ClaudeSessionSourceFailure | ClaudeSessionPreviewError;

export interface ClaudeSessionCatalogShape {
  readonly listSessions: (
    query: ClaudeSessionCatalogueQuery,
  ) => Effect.Effect<ClaudeSessionCataloguePage, ClaudeSessionSourceFailure>;
  readonly findSession: (
    nativeSessionId: string,
    cwd: string,
  ) => Effect.Effect<ValidatedClaudeSessionSource, ClaudeSessionSourceFailure>;
  readonly previewSession: (
    nativeSessionId: string,
    cwd: string,
  ) => Effect.Effect<ClaudeSessionPreview, ClaudeSessionCatalogFailure>;
  readonly validateAttachedSource: (input: {
    readonly sourcePath: string;
    readonly nativeSessionId: string;
    readonly sourceCwd: string;
  }) => Effect.Effect<ValidatedClaudeSessionSource, ClaudeSessionSourceFailure>;
}

export class ClaudeSessionCatalog extends Context.Service<
  ClaudeSessionCatalog,
  ClaudeSessionCatalogShape
>()("t3/claudeSessions/ClaudeSessionCatalog") {}

function catalogError(
  operation: ClaudeSessionCatalogError["operation"],
  detail: string,
  options?: { readonly sourcePath?: string; readonly cause?: object },
): ClaudeSessionCatalogError {
  return new ClaudeSessionCatalogError({
    operation,
    detail,
    ...(options?.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${NodePath.sep}`) &&
    !NodePath.isAbsolute(relative)
  );
}

function toTitle(text: string | null, nativeSessionId: string): string {
  if (text === null) {
    return `Claude session ${nativeSessionId.slice(0, 8)}`;
  }
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 60 ? compact : `${compact.slice(0, 57)}...`;
}

function validateNativeSessionId(nativeSessionId: string): boolean {
  return NATIVE_CLAUDE_SESSION_ID.test(nativeSessionId);
}

function normalizeQuery(
  query: ClaudeSessionCatalogueQuery,
): Required<Pick<ClaudeSessionCatalogueQuery, "activityWindow" | "sort" | "limit" | "freshness">> &
  Omit<ClaudeSessionCatalogueQuery, "activityWindow" | "sort" | "limit" | "freshness"> {
  const trimmedQuery = query.query?.trim();
  return {
    ...(trimmedQuery === undefined || trimmedQuery.length === 0 ? {} : { query: trimmedQuery }),
    ...(query.cwd === undefined ? {} : { cwd: query.cwd }),
    ...(query.cwdPrefix === undefined ? {} : { cwdPrefix: query.cwdPrefix }),
    ...(query.projectRoot === undefined ? {} : { projectRoot: query.projectRoot }),
    activityWindow: query.activityWindow ?? "all",
    sort: query.sort ?? "nativeActivity",
    limit: Math.min(
      query.limit ?? CLAUDE_SESSION_CATALOGUE_DEFAULT_LIMIT,
      CLAUDE_SESSION_CATALOGUE_MAX_LIMIT,
    ),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    freshness: query.freshness ?? "allow-stale",
  };
}

function mapDaemonSession(
  session: CcsCatalogueProtocolPage["sessions"][number],
): ClaudeSessionCatalogListEntry {
  return {
    providerInstanceId: session.providerInstanceId,
    localSourceHost: session.localSourceHost,
    nativeSessionId: session.nativeSessionId,
    sourceCwd: session.sourceCwd,
    projectRoot: session.projectRoot,
    projectName: session.projectName,
    title: session.title,
    titleSource: session.titleSource,
    branch: session.branch,
    firstActivityAt: session.firstActivityAt,
    latestActivityAt: session.latestActivityAt,
    messageCount: session.messageCount,
    observedSize: session.observedSize,
    observedMtimeMs: session.observedMtimeMs,
  };
}

function activityCutoff(window: "today" | "7d" | "30d" | "all", nowMs: number): number | null {
  switch (window) {
    case "all":
      return null;
    case "today": {
      // Match the CCS v1 activity-window definition, which uses host-local midnight.
      // @effect-diagnostics-next-line globalDate:off
      const date = new Date(nowMs);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    case "7d":
      return nowMs - 7 * 24 * 60 * 60 * 1_000;
    case "30d":
      return nowMs - 30 * 24 * 60 * 60 * 1_000;
  }
}

function catalogueFallbackAllowed(error: CcsCatalogueClientError): boolean {
  return (
    error.code === "unavailable" ||
    error.code === "protocol_error" ||
    error.code === "refresh_failed" ||
    error.code === "internal_error"
  );
}

function sourceLookupFallbackAllowed(error: CcsCatalogueClientError): boolean {
  return catalogueFallbackAllowed(error);
}

const makeClaudeSessionCatalog = Effect.gen(function* () {
  const claudeHome = yield* ClaudeHome;
  const daemon = yield* Effect.serviceOption(CcsCatalogueClient);
  const localSourceHost = NodeOS.hostname();

  const getProjectsRoot: () => Effect.Effect<string, ClaudeSessionCatalogError> = Effect.fn(
    "ClaudeSessionCatalog.getProjectsRoot",
  )(function* () {
    const canonicalHome = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(claudeHome.homePath),
      catch: (cause) =>
        catalogError(
          "claude-home",
          `Cannot resolve configured Claude home '${claudeHome.homePath}'.`,
          { cause: { cause } },
        ),
    });
    const projectsRoot = NodePath.join(canonicalHome, "projects");
    return yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(projectsRoot),
      catch: (cause) =>
        catalogError(
          "projects-root",
          `Cannot resolve Claude projects directory '${projectsRoot}'.`,
          { cause: { cause } },
        ),
    });
  });

  const canUseDaemon = (): boolean => {
    if (process.env.CCS_CATALOGUE_SOCKET?.trim()) {
      return true;
    }
    return NodePath.resolve(claudeHome.homePath) === NodePath.join(NodeOS.homedir(), ".claude");
  };

  const canonicalizeSourcePath: (
    sourcePath: string,
  ) => Effect.Effect<string, ClaudeSessionCatalogError> = Effect.fn(
    "ClaudeSessionCatalog.canonicalizeSourcePath",
  )(function* (sourcePath: string) {
    const projectsRoot = yield* getProjectsRoot();
    const canonicalSourcePath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(sourcePath),
      catch: (cause) =>
        catalogError("source-path", "Cannot resolve Claude session source path.", {
          sourcePath,
          cause: { cause },
        }),
    });
    if (
      !canonicalSourcePath.endsWith(".jsonl") ||
      !isPathWithinRoot(projectsRoot, canonicalSourcePath)
    ) {
      return yield* catalogError(
        "source-path",
        "Claude session source must be a JSONL file contained by the configured projects root.",
        { sourcePath: canonicalSourcePath },
      );
    }
    const stat = yield* Effect.tryPromise({
      try: () => NodeFSP.stat(canonicalSourcePath),
      catch: (cause) =>
        catalogError("source-path", "Cannot stat Claude session source path.", {
          sourcePath: canonicalSourcePath,
          cause: { cause },
        }),
    });
    if (!stat.isFile()) {
      return yield* catalogError("source-path", "Claude session source is not a regular file.", {
        sourcePath: canonicalSourcePath,
      });
    }
    return canonicalSourcePath;
  });

  const scanSource: (
    sourcePath: string,
  ) => Effect.Effect<ClaudeSessionCatalogEntry, ClaudeSessionSourceFailure> = Effect.fn(
    "ClaudeSessionCatalog.scanSource",
  )(function* (sourcePath: string) {
    const canonicalSourcePath = yield* canonicalizeSourcePath(sourcePath);
    const read = yield* readCompleteClaudeJsonlRecords({
      sourcePath: canonicalSourcePath,
      startByteOffset: 0,
      startLineOrdinal: 0,
      maxRecords: CATALOG_SCAN_MAX_RECORDS,
      maxBytes: CATALOG_SCAN_MAX_BYTES,
    });

    let nativeSessionId: string | null = null;
    let sourceCwd: string | null = null;
    let titleText: string | null = null;
    let firstActivityAt: string | null = null;
    let latestActivityAt: string | null = null;
    let messageCount = 0;
    let malformedRecordCount = 0;

    for (const rawRecord of read.records) {
      const normalized = normalizeClaudeJsonlLine({
        line: rawRecord.line,
        lineOrdinal: rawRecord.lineOrdinal,
      });
      if (normalized.kind === "malformed") {
        malformedRecordCount += 1;
        continue;
      }
      if (normalized.kind === "ignored") {
        nativeSessionId ??= normalized.nativeSessionId;
        sourceCwd ??= normalized.cwd;
        continue;
      }
      nativeSessionId ??= normalized.record.nativeSessionId;
      sourceCwd ??= normalized.record.cwd;
      if (normalized.record.timestamp !== null) {
        if (
          firstActivityAt === null ||
          normalized.record.timestamp.localeCompare(firstActivityAt) < 0
        ) {
          firstActivityAt = normalized.record.timestamp;
        }
        if (
          latestActivityAt === null ||
          normalized.record.timestamp.localeCompare(latestActivityAt) > 0
        ) {
          latestActivityAt = normalized.record.timestamp;
        }
      }
      messageCount += normalized.record.items.filter((item) => item.kind === "message").length;
      titleText ??= firstVisibleHumanText(normalized.record);
    }

    if (nativeSessionId === null || !validateNativeSessionId(nativeSessionId)) {
      return yield* catalogError(
        "source-session-id",
        "Claude source does not contain a valid native session UUID.",
        { sourcePath: canonicalSourcePath },
      );
    }
    if (sourceCwd === null || !NodePath.isAbsolute(sourceCwd)) {
      return yield* catalogError(
        "source-cwd",
        "Claude source does not contain an absolute working directory.",
        { sourcePath: canonicalSourcePath },
      );
    }

    return {
      ...read,
      nativeSessionId,
      sourcePath: canonicalSourcePath,
      sourceCwd,
      title: toTitle(titleText, nativeSessionId),
      firstActivityAt,
      latestActivityAt,
      messageCount,
      malformedRecordCount,
    } satisfies ClaudeSessionCatalogEntry;
  });

  const listSourcePaths = Effect.fn("ClaudeSessionCatalog.listSourcePaths")(function* (
    maximumPaths: number | null,
    matchingFilename?: string,
  ) {
    const projectsRoot = yield* getProjectsRoot();
    const sourcePaths: string[] = [];
    let truncated = false;

    const visit: (directory: string) => Effect.Effect<void, ClaudeSessionCatalogError> = (
      directory,
    ) =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => NodeFSP.readdir(directory, { withFileTypes: true }),
          catch: (cause) =>
            catalogError("projects-root", `Cannot read Claude projects directory '${directory}'.`, {
              cause: { cause },
            }),
        });
        for (const entry of entries) {
          if (maximumPaths !== null && sourcePaths.length >= maximumPaths) {
            truncated = true;
            return;
          }
          const entryPath = NodePath.join(directory, entry.name);
          if (entry.isSymbolicLink()) {
            continue;
          }
          if (entry.isDirectory()) {
            if (entry.name === "subagents") {
              continue;
            }
            yield* visit(entryPath);
            if (truncated) {
              return;
            }
            continue;
          }
          if (
            entry.isFile() &&
            entry.name.endsWith(".jsonl") &&
            (matchingFilename === undefined || entry.name === matchingFilename)
          ) {
            sourcePaths.push(entryPath);
          }
        }
      });

    yield* visit(projectsRoot);
    return { sourcePaths: sourcePaths.toSorted(), truncated };
  });

  const degradedPage = Effect.fn("ClaudeSessionCatalog.degradedPage")(function* (
    query: ReturnType<typeof normalizeQuery>,
    reason: string,
  ) {
    if (query.cursor !== undefined) {
      return yield* catalogError(
        "catalogue-query",
        "The degraded built-in catalogue cannot continue a daemon cursor; restart from page one.",
      );
    }

    const discovery = yield* listSourcePaths(DEGRADED_CATALOGUE_DISCOVERY_LIMIT);
    const sourcePaths = discovery.sourcePaths;
    const candidateStats = yield* Effect.forEach(
      sourcePaths,
      (sourcePath) =>
        Effect.tryPromise({
          try: async () => ({ sourcePath, stat: await NodeFSP.stat(sourcePath) }),
          catch: (cause) =>
            catalogError("source-path", "Cannot stat degraded catalogue candidate.", {
              sourcePath,
              cause: { cause },
            }),
        }).pipe(Effect.option),
      { concurrency: 16 },
    );
    const candidates = candidateStats
      .flatMap((entry) => (Option.isSome(entry) ? [entry.value] : []))
      .filter((entry): entry is { readonly sourcePath: string; readonly stat: NodeFS.Stats } =>
        entry.stat.isFile(),
      )
      .toSorted(
        (left, right) =>
          right.stat.mtimeMs - left.stat.mtimeMs || left.sourcePath.localeCompare(right.sourcePath),
      )
      .slice(0, DEGRADED_CATALOGUE_CANDIDATE_LIMIT);
    const scanned = yield* Effect.forEach(
      candidates,
      ({ sourcePath }) => Effect.option(scanSource(sourcePath)),
      { concurrency: 4 },
    );
    const cutoff = activityCutoff(query.activityWindow, yield* Clock.currentTimeMillis);
    const loweredQuery = query.query?.toLowerCase();
    const normalizedPrefix = query.cwdPrefix?.replace(/[\\/]+$/, "");
    const sessions = scanned
      .flatMap((entry) => (Option.isSome(entry) ? [entry.value] : []))
      .map(
        (entry): ClaudeSessionCatalogListEntry => ({
          providerInstanceId: DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID,
          localSourceHost,
          nativeSessionId: entry.nativeSessionId,
          sourceCwd: entry.sourceCwd,
          projectRoot: entry.sourceCwd,
          projectName: NodePath.basename(entry.sourceCwd) || "Claude project",
          title: `Claude session ${entry.nativeSessionId.slice(0, 8)}`,
          titleSource: "fallback",
          branch: null,
          firstActivityAt: entry.firstActivityAt,
          latestActivityAt: entry.latestActivityAt,
          messageCount: entry.messageCount,
          observedSize: entry.observedSize,
          observedMtimeMs: entry.observedMtimeMs,
        }),
      )
      .filter((entry) => query.cwd === undefined || entry.sourceCwd === query.cwd)
      .filter(
        (entry) =>
          normalizedPrefix === undefined ||
          entry.sourceCwd === normalizedPrefix ||
          entry.sourceCwd.startsWith(`${normalizedPrefix}${NodePath.sep}`),
      )
      .filter((entry) => query.projectRoot === undefined || entry.projectRoot === query.projectRoot)
      .filter((entry) => {
        if (cutoff === null) {
          return true;
        }
        const activity =
          entry.latestActivityAt === null ? Number.NaN : Date.parse(entry.latestActivityAt);
        return Number.isFinite(activity) && activity >= cutoff;
      })
      .filter((entry) => {
        if (loweredQuery === undefined) {
          return true;
        }
        return [entry.title, entry.sourceCwd, entry.projectName, entry.nativeSessionId].some(
          (value) => value.toLowerCase().includes(loweredQuery),
        );
      })
      .toSorted((left, right) => {
        switch (query.sort) {
          case "cwd":
            return (
              left.sourceCwd.localeCompare(right.sourceCwd) ||
              left.nativeSessionId.localeCompare(right.nativeSessionId)
            );
          case "title":
            return (
              left.title.localeCompare(right.title) ||
              left.nativeSessionId.localeCompare(right.nativeSessionId)
            );
          case "nativeActivity":
            return (
              (right.latestActivityAt ?? "").localeCompare(left.latestActivityAt ?? "") ||
              left.nativeSessionId.localeCompare(right.nativeSessionId)
            );
        }
      })
      .slice(0, query.limit);
    const generatedAt = DateTime.formatIso(yield* DateTime.now);
    const degradedReason = discovery.truncated
      ? `${reason} Built-in discovery stopped after ${DEGRADED_CATALOGUE_DISCOVERY_LIMIT} source files.`
      : reason;

    return {
      sessions,
      nextCursor: null,
      sourceStatus: {
        generation: 0,
        phase: "error",
        freshness: "uninitialized",
        indexedAt: null,
        refreshedAt: null,
        ageMs: null,
        staleAfterMs: 0,
        rowCount: sessions.length,
        lastError: { at: generatedAt, message: degradedReason },
        lastRefresh: {
          scanned: sourcePaths.length,
          parsed: scanned.filter(Option.isSome).length,
          skipped: Math.max(0, sourcePaths.length - scanned.filter(Option.isSome).length),
          removed: 0,
        },
      },
      mode: {
        kind: "builtin-degraded",
        reason: degradedReason,
        candidateLimit: DEGRADED_CATALOGUE_CANDIDATE_LIMIT,
      },
    } satisfies ClaudeSessionCataloguePage;
  });

  const listSessions: ClaudeSessionCatalogShape["listSessions"] = (input) => {
    const query = normalizeQuery(input);
    if (!canUseDaemon()) {
      return degradedPage(
        query,
        "The configured Claude home is not the default CCS store; using the bounded built-in catalogue.",
      );
    }
    if (Option.isNone(daemon)) {
      return degradedPage(
        query,
        "The CCS catalogue client is unavailable; using the bounded built-in catalogue.",
      );
    }
    return daemon.value.queryRootSessions(query).pipe(
      Effect.map(
        (page): ClaudeSessionCataloguePage => ({
          sessions: page.sessions.map(mapDaemonSession),
          nextCursor: page.nextCursor,
          sourceStatus: page.sourceStatus,
          mode: {
            kind: "ccs-daemon",
            protocolVersion: 1,
          },
        }),
      ),
      Effect.catch((error) =>
        catalogueFallbackAllowed(error)
          ? degradedPage(query, error.message)
          : catalogError("catalogue-query", error.detail, { cause: { error } }),
      ),
    );
  };

  const validateAttachedSource: ClaudeSessionCatalogShape["validateAttachedSource"] = (input) =>
    Effect.gen(function* () {
      if (!validateNativeSessionId(input.nativeSessionId)) {
        return yield* catalogError("source-session-id", "Native session id must be a UUID.", {
          sourcePath: input.sourcePath,
        });
      }
      const entry = yield* scanSource(input.sourcePath);
      if (entry.nativeSessionId !== input.nativeSessionId) {
        return yield* catalogError(
          "source-session-id",
          "Claude source native session UUID does not match its persisted binding.",
          { sourcePath: entry.sourcePath },
        );
      }
      const canonicalSourceCwd = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(entry.sourceCwd),
        catch: (cause) =>
          catalogError("source-cwd", "Claude source working directory no longer exists.", {
            sourcePath: entry.sourcePath,
            cause: { cause },
          }),
      });
      const cwdStat = yield* Effect.tryPromise({
        try: () => NodeFSP.stat(canonicalSourceCwd),
        catch: (cause) =>
          catalogError("source-cwd", "Cannot stat Claude source working directory.", {
            sourcePath: entry.sourcePath,
            cause: { cause },
          }),
      });
      if (!cwdStat.isDirectory()) {
        return yield* catalogError(
          "source-cwd",
          "Claude source working directory is not a directory.",
          { sourcePath: entry.sourcePath },
        );
      }
      const persistedCwd = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(input.sourceCwd),
        catch: (cause) =>
          catalogError(
            "source-cwd",
            "Persisted Claude source working directory no longer exists.",
            { sourcePath: entry.sourcePath, cause: { cause } },
          ),
      });
      if (canonicalSourceCwd !== persistedCwd) {
        return yield* catalogError(
          "cwd-mismatch",
          "Claude source working directory no longer matches its persisted binding.",
          { sourcePath: entry.sourcePath },
        );
      }
      return { ...entry, sourceCwd: canonicalSourceCwd };
    });

  const findSessionWithBuiltin = Effect.fn("ClaudeSessionCatalog.findSessionWithBuiltin")(
    function* (nativeSessionId: string, cwd: string) {
      const exactFilename = `${nativeSessionId}.jsonl`;
      const discovery = yield* listSourcePaths(null, exactFilename);
      const candidatePaths = discovery.sourcePaths;
      const scanned = yield* Effect.forEach(
        candidatePaths,
        (sourcePath) => Effect.option(scanSource(sourcePath)),
        { concurrency: 4 },
      );
      const matches = scanned.flatMap((entry) =>
        Option.isSome(entry) && entry.value.nativeSessionId === nativeSessionId
          ? [entry.value]
          : [],
      );
      if (matches.length === 0) {
        return yield* catalogError(
          "session-not-found",
          "Claude session was not found in the configured home.",
        );
      }
      const validated = yield* Effect.forEach(matches, (entry) =>
        validateAttachedSource({
          sourcePath: entry.sourcePath,
          nativeSessionId,
          sourceCwd: cwd,
        }).pipe(Effect.option),
      );
      const cwdMatches = validated.flatMap((entry) => (Option.isSome(entry) ? [entry.value] : []));
      if (cwdMatches.length === 0) {
        return yield* catalogError(
          "cwd-mismatch",
          "Requested working directory does not match the native Claude session source.",
        );
      }
      if (cwdMatches.length > 1) {
        return yield* catalogError(
          "session-ambiguous",
          "More than one Claude transcript has the requested native session UUID and working directory.",
        );
      }
      const match = cwdMatches[0];
      if (match === undefined) {
        return yield* catalogError(
          "session-not-found",
          "Claude session was not found in the configured home.",
        );
      }
      return match;
    },
  );

  const findSession: ClaudeSessionCatalogShape["findSession"] = (nativeSessionId, cwd) => {
    if (!validateNativeSessionId(nativeSessionId)) {
      return Effect.fail(catalogError("source-session-id", "Native session id must be a UUID."));
    }
    if (!canUseDaemon() || Option.isNone(daemon)) {
      return findSessionWithBuiltin(nativeSessionId, cwd);
    }
    return daemon.value.lookupSource({ resumeId: nativeSessionId, cwd }).pipe(
      Effect.flatMap((result) =>
        validateAttachedSource({
          sourcePath: result.source.sourcePath,
          nativeSessionId,
          sourceCwd: cwd,
        }),
      ),
      Effect.catchTag("CcsCatalogueClientError", (error) => {
        if (sourceLookupFallbackAllowed(error)) {
          return findSessionWithBuiltin(nativeSessionId, cwd);
        }
        switch (error.code) {
          case "invalid_resume_id":
            return Effect.fail(
              catalogError("source-session-id", "Native session id must be a UUID."),
            );
          case "invalid_cwd":
          case "cwd_mismatch":
            return Effect.fail(catalogError("cwd-mismatch", error.detail));
          case "source_ambiguous":
            return Effect.fail(catalogError("session-ambiguous", error.detail));
          case "source_not_found":
            return Effect.fail(catalogError("session-not-found", error.detail));
          default:
            return Effect.fail(catalogError("source-path", error.detail, { cause: { error } }));
        }
      }),
    );
  };

  const previewSession: ClaudeSessionCatalogShape["previewSession"] = (nativeSessionId, cwd) =>
    Effect.gen(function* () {
      const source = yield* findSession(nativeSessionId, cwd);
      const preview = yield* readClaudeSessionPreview(source.sourcePath);
      return {
        providerInstanceId: DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID,
        localSourceHost,
        nativeSessionId: source.nativeSessionId,
        sourceCwd: source.sourceCwd,
        title: source.title,
        ...preview,
      } satisfies ClaudeSessionPreview;
    }).pipe(
      Effect.mapError((cause) =>
        isClaudeSessionCatalogError(cause)
          ? cause
          : catalogError("preview", cause.message, { cause: { cause } }),
      ),
    );

  return {
    listSessions,
    findSession,
    previewSession,
    validateAttachedSource,
  } satisfies ClaudeSessionCatalogShape;
});

export const ClaudeSessionCatalogLive = Layer.effect(
  ClaudeSessionCatalog,
  makeClaudeSessionCatalog,
);
