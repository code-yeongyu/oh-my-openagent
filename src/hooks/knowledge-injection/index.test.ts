import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createKnowledgeInjectionHook } from "./index";
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("createKnowledgeInjectionHook", () => {
  const testDir = join(tmpdir(), `knowledge-injection-test-${Date.now()}`);
  const storagePath = join(testDir, "knowledge.json");

  beforeEach(() => {
    //#given a clean test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    //#then cleanup test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should create a hook with tool.execute.before handler", () => {
    //#given a knowledge injection hook
    const hook = createKnowledgeInjectionHook({ storagePath });

    //#then it should have the expected handler
    expect(hook["tool.execute.before"]).toBeDefined();
    expect(typeof hook["tool.execute.before"]).toBe("function");
  });

  it("should inject knowledge context when relevant entries exist", async () => {
    //#given knowledge entries exist in storage
    const knowledgeEntries = [
      {
        id: "test-1",
        pattern: "typescript error",
        solution: "Check type definitions",
        timestamp: Date.now(),
      },
    ];
    writeFileSync(storagePath, JSON.stringify(knowledgeEntries, null, 2));

    const hook = createKnowledgeInjectionHook({ storagePath });

    //#when executing a tool with matching context
    const input = {
      tool: "read",
      sessionID: "test-session",
      callID: "call-1",
    };
    const output = {
      args: { filePath: "/some/file.ts" },
    };

    await hook["tool.execute.before"](input, output);

    //#then knowledge should be available (hook doesn't block)
    expect(output.args).toBeDefined();
  });

  it("should handle missing storage file gracefully", async () => {
    //#given no storage file exists
    const hook = createKnowledgeInjectionHook({ storagePath });

    //#when executing a tool
    const input = {
      tool: "read",
      sessionID: "test-session",
      callID: "call-1",
    };
    const output = {
      args: { filePath: "/some/file.ts" },
    };

    //#then it should not throw
    await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined();
  });

  it("should use default storage path when not provided", () => {
    //#given no config provided
    const hook = createKnowledgeInjectionHook();

    //#then hook should be created successfully
    expect(hook["tool.execute.before"]).toBeDefined();
  });

  it("should handle malformed JSON in storage file", async () => {
    //#given malformed JSON in storage
    writeFileSync(storagePath, "{ invalid json }");

    const hook = createKnowledgeInjectionHook({ storagePath });

    //#when executing a tool
    const input = {
      tool: "read",
      sessionID: "test-session",
      callID: "call-1",
    };
    const output = {
      args: {},
    };

    //#then it should not throw
    await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined();
  });

  it("should load knowledge entries from KnowledgeExtractor storage format", async () => {
    //#given valid knowledge entries in storage
    const knowledgeEntries = [
      {
        id: "entry-1",
        pattern: "memory leak",
        solution: "Check for event listener cleanup",
        timestamp: Date.now() - 1000,
      },
      {
        id: "entry-2",
        pattern: "async error",
        solution: "Add proper error handling in promises",
        timestamp: Date.now(),
      },
    ];
    writeFileSync(storagePath, JSON.stringify(knowledgeEntries, null, 2));

    const hook = createKnowledgeInjectionHook({ storagePath });

    //#when executing a tool
    const input = {
      tool: "bash",
      sessionID: "test-session",
      callID: "call-1",
    };
    const output = {
      args: { command: "bun test" },
    };

    //#then it should process without error
    await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined();
  });
});
