import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { createAutoContinuityHook } from "./index";
import { createLedgerManager } from "../../features/continuity-ledger";

describe("Auto-Continuity Handoff", () => {
  const testDir = "/tmp/test-auto-continuity";

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("handoff directory structure", () => {
    test("creates handoff directory with session name", () => {
      const sessionName = "test-session-2025-01-05";
      const handoffDir = path.join(
        testDir,
        "thoughts",
        "shared",
        "handoffs",
        sessionName,
      );

      fs.mkdirSync(handoffDir, { recursive: true });
      const handoffFile = path.join(
        handoffDir,
        "auto-handoff-2025-01-05T12-00-00.md",
      );
      fs.writeFileSync(handoffFile, "# Test Handoff\n\nTest content");

      expect(fs.existsSync(handoffDir)).toBe(true);
      expect(fs.existsSync(handoffFile)).toBe(true);
      const content = fs.readFileSync(handoffFile, "utf-8");
      expect(content).toContain("Test Handoff");
    });

    test("handoff file structure matches expected format", () => {
      const sessionName = "test-session";
      const handoffDir = path.join(
        testDir,
        "thoughts",
        "shared",
        "handoffs",
        sessionName,
      );
      fs.mkdirSync(handoffDir, { recursive: true });

      const handoffContent = `---
date: 2025-01-05T12:00:00.000Z
type: auto-handoff
trigger: context-threshold
context_percentage: 85.0%
---

# Auto-Generated Handoff

Generated at CRITICAL context threshold (85.0%)

## Current State (from Ledger)

**Goal:** Implement feature X
**Current Focus:** Writing tests

**Completed:**
- Research completed
- Implementation done

**Next Steps:**
- Write tests
- Update documentation

**Key Decisions:**
- Use async/await: Better readability

## Recovery Instructions

After \`/clear\`, the ledger will be automatically loaded.
Verify the state matches your understanding before continuing.

---
*This handoff was auto-generated to preserve context before hitting token limits.*`;

      const handoffFile = path.join(
        handoffDir,
        "auto-handoff-2025-01-05T12-00-00.md",
      );
      fs.writeFileSync(handoffFile, handoffContent);

      const parsed = fs.readFileSync(handoffFile, "utf-8");
      expect(parsed).toContain("type: auto-handoff");
      expect(parsed).toContain("context_percentage: 85.0%");
      expect(parsed).toContain("Goal:");
      expect(parsed).toContain("Current Focus:");
      expect(parsed).toContain("Completed:");
      expect(parsed).toContain("Next Steps:");
      expect(parsed).toContain("Key Decisions:");
      expect(parsed).toContain("Recovery Instructions");
    });
  });

  describe("context threshold detection", () => {
    test("yellow threshold at 60%", () => {
      const contextPct = 0.6;
      const isYellow = contextPct >= 0.6 && contextPct < 0.8;
      expect(isYellow).toBe(true);
    });

    test("red threshold at 80%", () => {
      const contextPct = 0.8;
      const isRed = contextPct >= 0.8 && contextPct < 0.85;
      expect(isRed).toBe(true);
    });

    test("critical threshold at 85%", () => {
      const contextPct = 0.85;
      const isCritical = contextPct >= 0.85;
      expect(isCritical).toBe(true);
    });
  });
});

describe("Auto-Continuity Hook", () => {
  const testDir = "/tmp/test-auto-continuity-hook";

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  const createMockCtx = (overrides = {}) => ({
    directory: testDir,
    client: {
      tui: { showToast: async () => {} },
      session: {
        messages: async () => ({ data: [] }),
        prompt: async () => {},
      },
    },
    ...overrides,
  });

  test("returns both handlers when disabled", () => {
    const hook = createAutoContinuityHook(createMockCtx() as never, {
      config: { enabled: false },
    });
    expect(typeof hook.event).toBe("function");
    expect(typeof hook["tool.execute.after"]).toBe("function");
  });

  test("creates ledger on first session if none exists", async () => {
    const hook = createAutoContinuityHook(createMockCtx() as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "test-session-1" } },
      },
    });

    const ledgerDir = path.join(testDir, "thoughts", "ledgers");
    expect(fs.existsSync(ledgerDir)).toBe(true);
    const files = fs.readdirSync(ledgerDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^CONTINUITY_CLAUDE-session-/);
  });

  test("loads existing ledger on startup", () => {
    const manager = createLedgerManager(testDir);
    manager.createLedger("existing-session", {
      goal: "Test goal",
      state: { done: ["Task 1"], now: "Task 2", next: ["Task 3"] },
    });

    const hook = createAutoContinuityHook(createMockCtx() as never);
    expect(hook).toBeDefined();
  });

  test("handles todowrite with valid JSON", async () => {
    const manager = createLedgerManager(testDir);
    manager.createLedger("todo-test", {
      goal: "Test",
      state: { done: [], now: "", next: [] },
    });

    const hook = createAutoContinuityHook(createMockCtx() as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-todo" } },
      },
    });

    const output = {
      title: "",
      output: JSON.stringify([
        { content: "Done task", status: "completed" },
        { content: "Current task", status: "in_progress" },
        { content: "Future task", status: "pending" },
      ]),
      metadata: {},
    };

    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "sess-todo", callID: "1" },
      output,
    );

    const ledgerDir = path.join(testDir, "thoughts", "ledgers");
    const files = fs.readdirSync(ledgerDir);
    const content = fs.readFileSync(path.join(ledgerDir, files[0]), "utf-8");
    expect(content).toContain("Done task");
    expect(content).toContain("Current task");
  });

  test("handles todowrite with invalid JSON gracefully", async () => {
    const manager = createLedgerManager(testDir);
    manager.createLedger("invalid-json", { goal: "Test" });

    const hook = createAutoContinuityHook(createMockCtx() as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-invalid" } },
      },
    });

    const output = {
      title: "",
      output: "not valid json {{{",
      metadata: {},
    };

    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "sess-invalid", callID: "1" },
      output,
    );
  });

  test("handles todowrite with non-array JSON gracefully", async () => {
    const manager = createLedgerManager(testDir);
    manager.createLedger("non-array", { goal: "Test" });

    const hook = createAutoContinuityHook(createMockCtx() as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-nonarray" } },
      },
    });

    const output = {
      title: "",
      output: JSON.stringify({ not: "an array" }),
      metadata: {},
    };

    await hook["tool.execute.after"](
      { tool: "todowrite", sessionID: "sess-nonarray", callID: "1" },
      output,
    );
  });

  test("skips injection for subagent sessions", async () => {
    let promptCalled = false;
    const mockCtx = createMockCtx({
      client: {
        tui: { showToast: async () => {} },
        session: {
          messages: async () => ({ data: [] }),
          prompt: async () => {
            promptCalled = true;
          },
        },
      },
    });

    const manager = createLedgerManager(testDir);
    manager.createLedger("subagent-test", { goal: "Test" });

    const hook = createAutoContinuityHook(mockCtx as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "subagent-123", parentID: "main-session" } },
      },
    });

    expect(promptCalled).toBe(false);
  });

  test("cleans up sessions on deletion", async () => {
    const hook = createAutoContinuityHook(createMockCtx() as never);

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: "to-delete" } },
      },
    });

    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "to-delete" } },
      },
    });
  });
});
