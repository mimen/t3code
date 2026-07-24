// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import { CLAUDE_SESSION_PREVIEW_EXCERPT_MAX_CHARS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CLAUDE_JSONL_MAX_LINE_BYTES,
  readCompleteClaudeJsonlRecords,
} from "./ClaudeJsonlReader.ts";
import { type ClaudeNormalizedMessage, normalizeClaudeJsonlLine } from "./ClaudeJsonlNormalizer.ts";

const FIRST_PREVIEW_MAX_RECORDS = 1_000;
const PREVIEW_TAIL_MAX_BYTES = 8 * 1024 * 1024;

export class ClaudeSessionPreviewError extends Schema.TaggedErrorClass<ClaudeSessionPreviewError>()(
  "ClaudeSessionPreviewError",
  {
    sourcePath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Claude session preview failed for '${this.sourcePath}': ${this.detail}`;
  }
}

export interface ClaudeSessionPreviewExcerpts {
  readonly firstUserExcerpt: string | null;
  readonly latestUserExcerpt: string | null;
  readonly latestAssistantExcerpt: string | null;
  readonly isPartial: boolean;
}

function previewError(
  sourcePath: string,
  detail: string,
  cause?: object,
): ClaudeSessionPreviewError {
  return new ClaudeSessionPreviewError({
    sourcePath,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= CLAUDE_SESSION_PREVIEW_EXCERPT_MAX_CHARS
    ? compact
    : `${compact.slice(0, CLAUDE_SESSION_PREVIEW_EXCERPT_MAX_CHARS - 3)}...`;
}

function visibleMessages(
  line: string,
  lineOrdinal: number,
): ReadonlyArray<ClaudeNormalizedMessage> {
  const normalized = normalizeClaudeJsonlLine({ line, lineOrdinal });
  if (normalized.kind !== "normalized") {
    return [];
  }
  return normalized.record.items.filter(
    (item): item is ClaudeNormalizedMessage => item.kind === "message",
  );
}

function completeTailLines(
  buffer: Buffer,
  startsMidFile: boolean,
  endsWithNewline: boolean,
): string[] {
  let start = 0;
  let end = buffer.length;
  if (startsMidFile) {
    const firstNewline = buffer.indexOf(0x0a);
    if (firstNewline < 0) {
      return [];
    }
    start = firstNewline + 1;
  }
  if (!endsWithNewline) {
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < start) {
      return [];
    }
    end = lastNewline + 1;
  }
  return buffer
    .subarray(start, end)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

export const readClaudeSessionPreview = Effect.fn("ClaudeSessionPreview.read")(function* (
  sourcePath: string,
): Effect.fn.Return<ClaudeSessionPreviewExcerpts, ClaudeSessionPreviewError> {
  const firstRead = yield* readCompleteClaudeJsonlRecords({
    sourcePath,
    startByteOffset: 0,
    startLineOrdinal: 0,
    maxRecords: FIRST_PREVIEW_MAX_RECORDS,
  }).pipe(
    Effect.mapError((cause) =>
      previewError(sourcePath, "Cannot read the first visible Claude session records.", { cause }),
    ),
  );

  let firstUserExcerpt: string | null = null;
  for (const rawRecord of firstRead.records) {
    const firstUser = visibleMessages(rawRecord.line, rawRecord.lineOrdinal).find(
      (message) => message.role === "user",
    );
    if (firstUser !== undefined) {
      firstUserExcerpt = excerpt(firstUser.text);
      break;
    }
  }

  const handle = yield* Effect.tryPromise({
    try: () => NodeFSP.open(firstRead.canonicalPath, "r"),
    catch: (cause) => previewError(sourcePath, "Cannot open the Claude session tail.", { cause }),
  });
  const tailResult = yield* Effect.acquireUseRelease(
    Effect.succeed(handle),
    (openHandle) =>
      Effect.gen(function* () {
        const stat = yield* Effect.tryPromise({
          try: () => openHandle.stat(),
          catch: (cause) =>
            previewError(sourcePath, "Cannot stat the Claude session tail.", { cause }),
        });
        const tailBytes = Math.min(stat.size, PREVIEW_TAIL_MAX_BYTES);
        const tailStart = stat.size - tailBytes;
        const buffer = Buffer.alloc(tailBytes);
        const { bytesRead } = yield* Effect.tryPromise({
          try: () => openHandle.read(buffer, 0, tailBytes, tailStart),
          catch: (cause) =>
            previewError(sourcePath, "Cannot read the Claude session tail.", { cause }),
        });
        const tail = buffer.subarray(0, bytesRead);
        const endsWithNewline = tail.length === 0 || tail[tail.length - 1] === 0x0a;
        return {
          startsMidFile: tailStart > 0,
          lines: completeTailLines(tail, tailStart > 0, endsWithNewline),
        };
      }),
    (openHandle) =>
      Effect.tryPromise({
        try: () => openHandle.close(),
        catch: (cause) =>
          previewError(sourcePath, "Cannot close the Claude session tail.", { cause }),
      }).pipe(Effect.orDie),
  );

  let latestUserExcerpt: string | null = null;
  let latestAssistantExcerpt: string | null = null;
  for (let index = tailResult.lines.length - 1; index >= 0; index -= 1) {
    const line = tailResult.lines[index];
    if (line === undefined || Buffer.byteLength(line) > CLAUDE_JSONL_MAX_LINE_BYTES) {
      continue;
    }
    const messages = visibleMessages(line, index + 1);
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      if (message === undefined) {
        continue;
      }
      if (message.role === "user" && latestUserExcerpt === null) {
        latestUserExcerpt = excerpt(message.text);
      }
      if (message.role === "assistant" && latestAssistantExcerpt === null) {
        latestAssistantExcerpt = excerpt(message.text);
      }
    }
    if (latestUserExcerpt !== null && latestAssistantExcerpt !== null) {
      break;
    }
  }

  return {
    firstUserExcerpt,
    latestUserExcerpt,
    latestAssistantExcerpt,
    isPartial:
      (firstUserExcerpt === null && firstRead.nextByteOffset < firstRead.observedSize) ||
      (tailResult.startsMidFile && (latestUserExcerpt === null || latestAssistantExcerpt === null)),
  };
});
