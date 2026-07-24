import { createHash } from "node:crypto";

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export type SanitizedJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<SanitizedJsonValue>
  | { readonly [key: string]: SanitizedJsonValue };

export interface ClaudeNormalizedMessage {
  readonly kind: "message";
  readonly sourceItemKey: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: string | null;
  readonly timelineIndex: number;
}

export interface ClaudeNormalizedActivity {
  readonly kind: "activity";
  readonly sourceItemKey: string;
  readonly activityKind: "claude-code.tool-call" | "claude-code.tool-result";
  readonly summary: string;
  readonly payload: SanitizedJsonValue;
  readonly timestamp: string | null;
  readonly timelineIndex: number;
}

export type ClaudeNormalizedHistoryItem = ClaudeNormalizedMessage | ClaudeNormalizedActivity;

export interface ClaudeNormalizedJsonlRecord {
  readonly lineOrdinal: number;
  readonly nativeSessionId: string | null;
  readonly cwd: string | null;
  readonly timestamp: string | null;
  readonly items: ReadonlyArray<ClaudeNormalizedHistoryItem>;
}

export type ClaudeJsonlLineNormalization =
  | { readonly kind: "normalized"; readonly record: ClaudeNormalizedJsonlRecord }
  | {
      readonly kind: "ignored";
      readonly nativeSessionId: string | null;
      readonly cwd: string | null;
    }
  | { readonly kind: "malformed"; readonly detail: string };

const MAX_SANITIZED_STRING_LENGTH = 4_000;
const MAX_SANITIZED_ARRAY_ITEMS = 32;
const MAX_SANITIZED_OBJECT_PROPERTIES = 32;
const MAX_SANITIZED_DEPTH = 4;

type JsonRecord = Readonly<Record<string, unknown>>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : null;
}

function stableRecordIdentifier(record: JsonRecord, lineOrdinal: number): string {
  const candidate = readString(record, "uuid") ?? readString(record, "id");
  return candidate === null ? `line-${lineOrdinal}` : candidate.replaceAll(":", "_");
}

function sanitizeJsonValue(value: unknown, depth = 0): SanitizedJsonValue {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_SANITIZED_STRING_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (depth >= MAX_SANITIZED_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SANITIZED_ARRAY_ITEMS)
      .map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (isJsonRecord(value)) {
    const result: Record<string, SanitizedJsonValue> = {};
    for (const key of Object.keys(value).sort().slice(0, MAX_SANITIZED_OBJECT_PROPERTIES)) {
      const nestedValue = value[key];
      if (nestedValue !== undefined) {
        result[key] = sanitizeJsonValue(nestedValue, depth + 1);
      }
    }
    return result;
  }
  return "[unsupported]";
}

function textFromToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  if (Array.isArray(value)) {
    return value
      .map(textFromToolResult)
      .filter((entry) => entry.length > 0)
      .join(" ")
      .slice(0, 240);
  }
  if (isJsonRecord(value)) {
    const text = readString(value, "text");
    if (text !== null) {
      return text.replace(/\s+/g, " ").trim().slice(0, 240);
    }
    return textFromToolResult(value.content);
  }
  return "";
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().length === 0 ? null : value;
}

function addMessage(
  items: ClaudeNormalizedHistoryItem[],
  input: {
    readonly recordIdentifier: string;
    readonly timestamp: string | null;
    readonly role: "user" | "assistant";
    readonly text: string;
  },
): void {
  const timelineIndex = items.length;
  items.push({
    kind: "message",
    sourceItemKey: `${input.recordIdentifier}:message:${timelineIndex}`,
    role: input.role,
    text: input.text,
    timestamp: input.timestamp,
    timelineIndex,
  });
}

function addToolCall(
  items: ClaudeNormalizedHistoryItem[],
  input: {
    readonly recordIdentifier: string;
    readonly timestamp: string | null;
    readonly block: JsonRecord;
  },
): void {
  const timelineIndex = items.length;
  const toolName = readString(input.block, "name") ?? "tool";
  const toolUseId = readString(input.block, "id");
  items.push({
    kind: "activity",
    sourceItemKey: `${input.recordIdentifier}:tool-call:${timelineIndex}`,
    activityKind: "claude-code.tool-call",
    summary: `Tool call: ${toolName}`,
    payload: {
      name: toolName,
      ...(toolUseId === null ? {} : { toolUseId }),
      input: sanitizeJsonValue(input.block.input),
    },
    timestamp: input.timestamp,
    timelineIndex,
  });
}

function addToolResult(
  items: ClaudeNormalizedHistoryItem[],
  input: {
    readonly recordIdentifier: string;
    readonly timestamp: string | null;
    readonly block: JsonRecord;
  },
): void {
  const timelineIndex = items.length;
  const toolUseId = readString(input.block, "tool_use_id") ?? readString(input.block, "toolUseId");
  const content = input.block.content;
  const preview = textFromToolResult(content);
  items.push({
    kind: "activity",
    sourceItemKey: `${input.recordIdentifier}:tool-result:${timelineIndex}`,
    activityKind: "claude-code.tool-result",
    summary: preview.length === 0 ? "Tool result" : `Tool result: ${preview}`,
    payload: {
      ...(toolUseId === null ? {} : { toolUseId }),
      content: sanitizeJsonValue(content),
      ...(input.block.is_error === true || input.block.isError === true ? { isError: true } : {}),
    },
    timestamp: input.timestamp,
    timelineIndex,
  });
}

function normalizeMessageContent(
  items: ClaudeNormalizedHistoryItem[],
  input: {
    readonly recordIdentifier: string;
    readonly timestamp: string | null;
    readonly role: "user" | "assistant";
    readonly content: unknown;
  },
): boolean {
  const stringContent = normalizedText(input.content);
  if (stringContent !== null) {
    addMessage(items, { ...input, text: stringContent });
    return false;
  }
  if (!Array.isArray(input.content)) {
    return false;
  }

  let sawToolResult = false;
  for (const blockValue of input.content) {
    if (!isJsonRecord(blockValue)) {
      continue;
    }
    const type = readString(blockValue, "type");
    if (type === "text") {
      const text = normalizedText(blockValue.text);
      if (text !== null) {
        addMessage(items, { ...input, text });
      }
      continue;
    }
    if (type === "tool_use" && input.role === "assistant") {
      addToolCall(items, { ...input, block: blockValue });
      continue;
    }
    if (type === "tool_result") {
      addToolResult(items, { ...input, block: blockValue });
      sawToolResult = true;
    }
  }
  return sawToolResult;
}

/**
 * Parses one complete Claude Code JSONL record into visible immutable timeline
 * entries. Thinking blocks, system payloads, and sidechain/subagent records are
 * intentionally ignored; tool entries become inert activities only.
 */
export function normalizeClaudeJsonlLine(input: {
  readonly line: string;
  readonly lineOrdinal: number;
}): ClaudeJsonlLineNormalization {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.line) as unknown;
  } catch {
    return { kind: "malformed", detail: "Record is not valid JSON." };
  }
  if (!isJsonRecord(parsed)) {
    return { kind: "malformed", detail: "Record must be a JSON object." };
  }

  const nativeSessionId = readString(parsed, "sessionId");
  const cwd = readString(parsed, "cwd");
  if (parsed.isSidechain === true) {
    return { kind: "ignored", nativeSessionId, cwd };
  }

  const recordType = readString(parsed, "type");
  if (recordType !== "user" && recordType !== "assistant") {
    return { kind: "ignored", nativeSessionId, cwd };
  }

  const message = parsed.message;
  if (!isJsonRecord(message)) {
    return {
      kind: "malformed",
      detail: `${recordType} record does not contain a message object.`,
    };
  }

  const role = readString(message, "role");
  const expectedRole = recordType === "user" ? "user" : "assistant";
  if (role !== expectedRole) {
    return {
      kind: "malformed",
      detail: `${recordType} record has an invalid message role.`,
    };
  }

  const timestamp = toIsoTimestamp(parsed.timestamp);
  const items: ClaudeNormalizedHistoryItem[] = [];
  const recordIdentifier = stableRecordIdentifier(parsed, input.lineOrdinal);
  const sawToolResult = normalizeMessageContent(items, {
    recordIdentifier,
    timestamp,
    role: expectedRole,
    content: message.content,
  });

  if (recordType === "user" && !sawToolResult && parsed.toolUseResult !== undefined) {
    addToolResult(items, {
      recordIdentifier,
      timestamp,
      block: {
        ...(readString(parsed, "toolUseId") === null
          ? {}
          : { toolUseId: readString(parsed, "toolUseId") }),
        content: parsed.toolUseResult,
      },
    });
  }

  return {
    kind: "normalized",
    record: {
      lineOrdinal: input.lineOrdinal,
      nativeSessionId,
      cwd,
      timestamp,
      items,
    },
  };
}

/**
 * Stable content identity for an already-normalized source item. It never
 * hashes raw JSONL lines, so skipped reasoning and opaque system payloads do
 * not enter T3 persistence.
 */
export function hashNormalizedClaudeHistoryItem(item: ClaudeNormalizedHistoryItem): string {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

export function firstVisibleHumanText(record: ClaudeNormalizedJsonlRecord): string | null {
  const item = record.items.find(
    (candidate): candidate is ClaudeNormalizedMessage =>
      candidate.kind === "message" && candidate.role === "user",
  );
  return item === undefined ? null : item.text;
}
