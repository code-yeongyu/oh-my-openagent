import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { recordAction } from "./session-recorder";

describe("session-recorder recordingDir branch", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "idm-recorder-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("#given recordingDir #when recordAction #then writes to <dir>/session.jsonl", () => {
    const recordingDir = join(tempDir, "my-recording");
    mkdirSync(recordingDir);
    
    const action: any = {
      ts: Date.now(),
      tool: "test_tool",
      params: {},
      sessionId: "test-session",
      durationMs: 100,
      success: true,
      recordingDir // This is the new parameter we want to support
    };

    recordAction(action);

    const expectedFile = join(recordingDir, "session.jsonl");
    expect(existsSync(expectedFile)).toBe(true);
    
    const content = JSON.parse(readFileSync(expectedFile, "utf-8"));
    expect(content.tool).toBe("test_tool");
  });
});
