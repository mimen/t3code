// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const READ_CHUNK_BYTES = 64 * 1024;
export const CLAUDE_JSONL_MAX_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 64;

export class ClaudeJsonlReadError extends Schema.TaggedErrorClass<ClaudeJsonlReadError>()(
  "ClaudeJsonlReadError",
  {
    sourcePath: Schema.String,
    operation: Schema.Literals(["realpath", "stat", "open", "read", "close", "line-too-large"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Claude JSONL ${this.operation} failed for '${this.sourcePath}': ${this.detail}`;
  }
}

export interface ClaudeJsonlFileMetadata {
  readonly canonicalPath: string;
  readonly fileIdentity: string;
  readonly observedSize: number;
  readonly observedMtimeMs: number;
}

export interface CompleteClaudeJsonlRecord {
  readonly line: string;
  readonly lineOrdinal: number;
  readonly startByteOffset: number;
  readonly endByteOffset: number;
}

export interface ReadCompleteClaudeJsonlRecordsInput {
  readonly sourcePath: string;
  readonly startByteOffset: number;
  readonly startLineOrdinal: number;
  readonly maxRecords?: number;
  readonly maxBytes?: number;
}

export interface ReadCompleteClaudeJsonlRecordsResult extends ClaudeJsonlFileMetadata {
  readonly records: ReadonlyArray<CompleteClaudeJsonlRecord>;
  readonly nextByteOffset: number;
  readonly nextLineOrdinal: number;
  readonly hasIncompleteTail: boolean;
  readonly reachedLimit: boolean;
}

function toFileIdentity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}`;
}

function readError(
  sourcePath: string,
  operation: ClaudeJsonlReadError["operation"],
  detail: string,
  cause?: unknown,
): ClaudeJsonlReadError {
  return new ClaudeJsonlReadError({
    sourcePath,
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Hashes an exact byte prefix without materializing the transcript in memory. */
export const hashClaudeJsonlPrefix = Effect.fn("ClaudeJsonlReader.hashPrefix")(function* (input: {
  readonly sourcePath: string;
  readonly byteLength: number;
}) {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
    return yield* readError(
      input.sourcePath,
      "read",
      "Prefix byte length must be a non-negative safe integer.",
    );
  }
  const canonicalPath = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(input.sourcePath),
    catch: (cause) => readError(input.sourcePath, "realpath", "Cannot resolve source path.", cause),
  });
  const stat = yield* Effect.tryPromise({
    try: () => NodeFSP.stat(canonicalPath),
    catch: (cause) => readError(canonicalPath, "stat", "Cannot stat source file.", cause),
  });
  if (!stat.isFile() || input.byteLength > stat.size) {
    return yield* readError(
      canonicalPath,
      "read",
      "Prefix byte length exceeds the current source file size.",
    );
  }

  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => NodeFSP.open(canonicalPath, "r"),
      catch: (cause) => readError(canonicalPath, "open", "Cannot open source file.", cause),
    }),
    (handle) =>
      Effect.gen(function* () {
        const hash = createHash("sha256");
        let position = 0;
        while (position < input.byteLength) {
          const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, input.byteLength - position));
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => handle.read(buffer, 0, buffer.length, position),
            catch: (cause) => readError(canonicalPath, "read", "Cannot read source prefix.", cause),
          });
          if (bytesRead === 0) {
            return yield* readError(canonicalPath, "read", "Source file ended before its prefix.");
          }
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        return hash.digest("hex");
      }),
    (handle) =>
      Effect.tryPromise({
        try: () => handle.close(),
        catch: (cause) => readError(canonicalPath, "close", "Cannot close source file.", cause),
      }).pipe(Effect.orDie),
  );
});

/**
 * Reads only complete, newline-terminated JSONL records after a byte checkpoint.
 * A final unterminated line is deliberately left uncommitted so a concurrently
 * running Claude Code process can finish it before the next synchronization.
 */
export const readCompleteClaudeJsonlRecords = Effect.fn("readCompleteClaudeJsonlRecords")(
  function* (
    input: ReadCompleteClaudeJsonlRecordsInput,
  ): Effect.fn.Return<ReadCompleteClaudeJsonlRecordsResult, ClaudeJsonlReadError> {
    if (!Number.isSafeInteger(input.startByteOffset) || input.startByteOffset < 0) {
      return yield* readError(
        input.sourcePath,
        "read",
        "Checkpoint byte offset must be a non-negative safe integer.",
      );
    }
    if (!Number.isSafeInteger(input.startLineOrdinal) || input.startLineOrdinal < 0) {
      return yield* readError(
        input.sourcePath,
        "read",
        "Checkpoint line ordinal must be a non-negative safe integer.",
      );
    }

    const canonicalPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.sourcePath),
      catch: (cause) =>
        readError(input.sourcePath, "realpath", "Cannot resolve source path.", cause),
    });
    const stat = yield* Effect.tryPromise({
      try: () => NodeFSP.stat(canonicalPath),
      catch: (cause) => readError(canonicalPath, "stat", "Cannot stat source file.", cause),
    });
    if (!stat.isFile()) {
      return yield* readError(canonicalPath, "stat", "Source path is not a regular file.");
    }
    if (input.startByteOffset > stat.size) {
      return yield* readError(
        canonicalPath,
        "read",
        "Checkpoint byte offset exceeds the current source size.",
      );
    }

    const metadata: ClaudeJsonlFileMetadata = {
      canonicalPath,
      fileIdentity: toFileIdentity(stat),
      observedSize: stat.size,
      observedMtimeMs: Math.trunc(stat.mtimeMs),
    };
    const maxRecords = input.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      return yield* readError(
        canonicalPath,
        "read",
        "Maximum records must be a positive safe integer.",
      );
    }
    const maxBytes = input.maxBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      return yield* readError(
        canonicalPath,
        "read",
        "Maximum committed bytes must be a positive safe integer.",
      );
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => NodeFSP.open(canonicalPath, "r"),
        catch: (cause) => readError(canonicalPath, "open", "Cannot open source file.", cause),
      }),
      (handle) =>
        Effect.gen(function* () {
          const records: CompleteClaudeJsonlRecord[] = [];
          let readPosition = input.startByteOffset;
          let lineOrdinal = input.startLineOrdinal;
          let nextByteOffset = input.startByteOffset;
          let pending = Buffer.alloc(0);
          let pendingStartByteOffset = input.startByteOffset;
          let stop = false;

          while (readPosition < stat.size && !stop) {
            const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, stat.size - readPosition));
            const { bytesRead } = yield* Effect.tryPromise({
              try: () => handle.read(buffer, 0, buffer.length, readPosition),
              catch: (cause) => readError(canonicalPath, "read", "Cannot read source file.", cause),
            });
            if (bytesRead === 0) {
              break;
            }

            const chunk = buffer.subarray(0, bytesRead);
            const combinedStartByteOffset = pendingStartByteOffset;
            const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
            let segmentStart = 0;

            for (let index = 0; index < combined.length; index += 1) {
              if (combined[index] !== 0x0a) {
                continue;
              }
              const end = index + 1;
              const rawLine = combined.subarray(segmentStart, end);
              if (rawLine.length > CLAUDE_JSONL_MAX_LINE_BYTES) {
                return yield* readError(
                  canonicalPath,
                  "line-too-large",
                  `A single complete or partial source line exceeds ${CLAUDE_JSONL_MAX_LINE_BYTES} bytes.`,
                );
              }
              const lineEndByteOffset = combinedStartByteOffset + end;
              const lineStartByteOffset = combinedStartByteOffset + segmentStart;
              if (
                nextByteOffset > input.startByteOffset &&
                lineEndByteOffset - input.startByteOffset > maxBytes
              ) {
                stop = true;
                break;
              }
              segmentStart = end;
              lineOrdinal += 1;
              nextByteOffset = lineEndByteOffset;

              const lineWithoutNewline = rawLine.subarray(
                0,
                rawLine.length > 1 && rawLine[rawLine.length - 2] === 0x0d
                  ? rawLine.length - 2
                  : rawLine.length - 1,
              );
              if (lineWithoutNewline.length === 0) {
                continue;
              }
              records.push({
                line: lineWithoutNewline.toString("utf8"),
                lineOrdinal,
                startByteOffset: lineStartByteOffset,
                endByteOffset: lineEndByteOffset,
              });
              if (records.length >= maxRecords) {
                stop = true;
                break;
              }
            }

            if (stop) {
              break;
            }
            pending = combined.subarray(segmentStart);
            pendingStartByteOffset = combinedStartByteOffset + segmentStart;
            if (pending.length > CLAUDE_JSONL_MAX_LINE_BYTES) {
              return yield* readError(
                canonicalPath,
                "line-too-large",
                `A single complete or partial source line exceeds ${CLAUDE_JSONL_MAX_LINE_BYTES} bytes.`,
              );
            }
            readPosition += bytesRead;
          }

          return {
            ...metadata,
            records,
            nextByteOffset,
            nextLineOrdinal: lineOrdinal,
            hasIncompleteTail: !stop && pending.length > 0,
            reachedLimit: stop,
          };
        }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) => readError(canonicalPath, "close", "Cannot close source file.", cause),
        }),
    );
  },
);
