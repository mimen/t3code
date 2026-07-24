// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CLAUDE_JSONL_MAX_LINE_BYTES,
  readCompleteClaudeJsonlRecords,
} from "./ClaudeJsonlReader.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

async function makeSourceFile(contents: string): Promise<string> {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-claude-jsonl-reader-"),
  );
  temporaryDirectories.push(directory);
  const sourcePath = NodePath.join(directory, "session.jsonl");
  await NodeFSP.writeFile(sourcePath, contents, "utf8");
  return sourcePath;
}

describe("readCompleteClaudeJsonlRecords", () => {
  it("leaves an incomplete final line uncommitted until it becomes newline-terminated", async () => {
    const firstLine = '{"type":"user","message":"first"}\n';
    const secondLine = '{"type":"assistant","message":"second"}';
    const sourcePath = await makeSourceFile(`${firstLine}${secondLine}`);

    const firstRead = await Effect.runPromise(
      readCompleteClaudeJsonlRecords({
        sourcePath,
        startByteOffset: 0,
        startLineOrdinal: 0,
      }),
    );
    expect(firstRead.records).toEqual([
      {
        line: '{"type":"user","message":"first"}',
        lineOrdinal: 1,
        startByteOffset: 0,
        endByteOffset: Buffer.byteLength(firstLine),
      },
    ]);
    expect(firstRead.nextByteOffset).toBe(Buffer.byteLength(firstLine));
    expect(firstRead.nextLineOrdinal).toBe(1);
    expect(firstRead.hasIncompleteTail).toBe(true);

    await NodeFSP.appendFile(sourcePath, "\n", "utf8");
    const secondRead = await Effect.runPromise(
      readCompleteClaudeJsonlRecords({
        sourcePath,
        startByteOffset: firstRead.nextByteOffset,
        startLineOrdinal: firstRead.nextLineOrdinal,
      }),
    );
    expect(secondRead.records).toEqual([
      {
        line: secondLine,
        lineOrdinal: 2,
        startByteOffset: Buffer.byteLength(firstLine),
        endByteOffset: Buffer.byteLength(`${firstLine}${secondLine}\n`),
      },
    ]);
    expect(secondRead.hasIncompleteTail).toBe(false);
  });

  it("never advances a checkpoint past the configured complete-record batch", async () => {
    const sourcePath = await makeSourceFile("one\ntwo\nthree\n");
    const read = await Effect.runPromise(
      readCompleteClaudeJsonlRecords({
        sourcePath,
        startByteOffset: 0,
        startLineOrdinal: 0,
        maxRecords: 2,
      }),
    );

    expect(read.records.map((record) => record.line)).toEqual(["one", "two"]);
    expect(read.nextByteOffset).toBe(Buffer.byteLength("one\ntwo\n"));
    expect(read.nextLineOrdinal).toBe(2);
  });

  it("bounds a batch by committed bytes without skipping the next record", async () => {
    const sourcePath = await makeSourceFile("one\ntwo\nthree\n");
    const read = await Effect.runPromise(
      readCompleteClaudeJsonlRecords({
        sourcePath,
        startByteOffset: 0,
        startLineOrdinal: 0,
        maxRecords: 10,
        maxBytes: Buffer.byteLength("one\ntwo\n"),
      }),
    );

    expect(read.records.map((record) => record.line)).toEqual(["one", "two"]);
    expect(read.nextByteOffset).toBe(Buffer.byteLength("one\ntwo\n"));
    expect(read.nextLineOrdinal).toBe(2);
    expect(read.reachedLimit).toBe(true);
  });

  it("rejects a complete line that exceeds the source record size limit", async () => {
    const sourcePath = await makeSourceFile(`${"x".repeat(CLAUDE_JSONL_MAX_LINE_BYTES)}\n`);

    await expect(
      Effect.runPromise(
        readCompleteClaudeJsonlRecords({
          sourcePath,
          startByteOffset: 0,
          startLineOrdinal: 0,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ClaudeJsonlReadError",
      operation: "line-too-large",
    });
  });
});
