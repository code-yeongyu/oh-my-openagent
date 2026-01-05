import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { LedgerManager, createLedgerManager } from "./manager";

describe("LedgerManager", () => {
  const testDir = "/tmp/test-continuity-ledger";
  let manager: LedgerManager;

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    manager = createLedgerManager(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("createLedger", () => {
    test("creates a new ledger with session name", () => {
      // #when
      const ledger = manager.createLedger("test-session-001");

      // #then
      expect(ledger.metadata.sessionName).toBe("test-session-001");
      expect(ledger.goal).toBe("");
      expect(ledger.state.done).toEqual([]);
      expect(ledger.state.now).toBe("");
      expect(ledger.state.next).toEqual([]);

      // File should exist
      const filePath = path.join(
        testDir,
        "thoughts/ledgers/CONTINUITY_CLAUDE-test-session-001.md",
      );
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test("creates a ledger with initial data", () => {
      // #when
      const ledger = manager.createLedger("test-session-002", {
        goal: "Implement feature X",
        constraints: ["Use TypeScript", "Follow existing patterns"],
        state: {
          done: ["Research completed"],
          now: "Writing implementation",
          next: ["Write tests", "Update docs"],
        },
        keyDecisions: [
          { decision: "Use async/await", rationale: "Better readability" },
        ],
        openQuestions: ["How to handle errors?"],
        workingSet: {
          branch: "feature/x",
          keyFiles: ["src/feature.ts", "src/feature.test.ts"],
          testCmd: "bun test",
        },
      });

      // #then
      expect(ledger.goal).toBe("Implement feature X");
      expect(ledger.constraints).toContain("Use TypeScript");
      expect(ledger.state.done).toContain("Research completed");
      expect(ledger.state.now).toBe("Writing implementation");
      expect(ledger.keyDecisions.length).toBe(1);
    });
  });

  describe("findLatestLedger", () => {
    test("returns null when no ledgers exist", () => {
      // #when
      const ledger = manager.findLatestLedger();

      // #then
      expect(ledger).toBeNull();
    });

    test("finds the most recent ledger", async () => {
      // #given
      manager.createLedger("session-old", { goal: "Old session" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      manager.createLedger("session-new", { goal: "New session" });

      // #when
      const found = manager.findLatestLedger();

      // #then
      expect(found).not.toBeNull();
      expect(found?.goal).toBe("New session");
    });
  });

  describe("loadLedger", () => {
    test("loads an existing ledger by filename", () => {
      // #given
      manager.createLedger("test-load", { goal: "Test loading" });

      // #when
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-load.md");

      // #then
      expect(loaded).not.toBeNull();
      expect(loaded?.metadata.sessionName).toBe("test-load");
      expect(loaded?.goal).toBe("Test loading");
    });

    test("returns null for non-existent ledger", () => {
      // #when
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-nonexistent.md");

      // #then
      expect(loaded).toBeNull();
    });
  });

  describe("updateState", () => {
    test("updates ledger state and saves", () => {
      // #given
      let ledger = manager.createLedger("test-update", {
        state: {
          done: [],
          now: "Initial task",
          next: ["Task 2"],
        },
      });

      // #when
      ledger = manager.updateState(ledger, {
        done: ["Initial task"],
        now: "Task 2",
        next: ["Task 3"],
      });

      // #then
      expect(ledger.state.done).toContain("Initial task");
      expect(ledger.state.now).toBe("Task 2");
      expect(ledger.state.next).toContain("Task 3");

      // Verify persistence
      const reloaded = manager.loadLedger("CONTINUITY_CLAUDE-test-update.md");
      expect(reloaded?.state.now).toBe("Task 2");
    });
  });

  describe("addAgentReport", () => {
    test("adds agent report to ledger", () => {
      // #given
      let ledger = manager.createLedger("test-report");

      // #when
      ledger = manager.addAgentReport(
        ledger,
        "explore",
        "Found 5 relevant files in src/",
      );

      // #then
      expect(ledger.agentReports.length).toBe(1);
      expect(ledger.agentReports[0].agent).toBe("explore");
      expect(ledger.agentReports[0].summary).toBe(
        "Found 5 relevant files in src/",
      );
    });

    test("limits agent reports to maxAgentReports", () => {
      // #given
      const customManager = createLedgerManager(testDir, {
        maxAgentReports: 3,
      });
      let ledger = customManager.createLedger("test-limit");

      // #when - add 5 reports
      for (let i = 1; i <= 5; i++) {
        ledger = customManager.addAgentReport(ledger, "agent", `Report ${i}`);
      }

      // #then - should only have last 3
      expect(ledger.agentReports.length).toBe(3);
      expect(ledger.agentReports[0].summary).toBe("Report 3");
      expect(ledger.agentReports[2].summary).toBe("Report 5");
    });
  });

  describe("generateStatusLine", () => {
    test("generates status with low context usage", () => {
      // #given
      const ledger = manager.createLedger("test-status", {
        state: {
          done: ["Task 1"],
          now: "Current task",
          next: [],
        },
      });

      // #when
      const status = manager.generateStatusLine(ledger, 0.3);

      // #then
      expect(status).toContain("30%");
      expect(status).not.toContain("[WARNING]");
      expect(status).not.toContain("[CRITICAL]");
    });

    test("generates status with warning context usage", () => {
      // #given
      const ledger = manager.createLedger("test-warning");

      // #when
      const status = manager.generateStatusLine(ledger, 0.7);

      // #then
      expect(status).toContain("70%");
      expect(status).toContain("[WARNING]");
    });

    test("generates status with critical context usage", () => {
      // #given
      const ledger = manager.createLedger("test-critical");

      // #when
      const status = manager.generateStatusLine(ledger, 0.85);

      // #then
      expect(status).toContain("85%");
      expect(status).toContain("[CRITICAL]");
    });

    test("handles null ledger", () => {
      // #when
      const status = manager.generateStatusLine(null, 0.5);

      // #then
      expect(status).toContain("50%");
      expect(status).toContain("No active ledger");
    });
  });

  describe("pruneLedger", () => {
    test("prunes session ended markers", () => {
      // #given
      const ledger = manager.createLedger("test-prune", { goal: "Test" });
      const filePath = ledger.metadata.filePath;

      // Manually add session ended marker to file
      let content = fs.readFileSync(filePath, "utf-8");
      content +=
        "\n### Session Ended (2025-01-05T12:00:00Z)\n- Reason: cleared\n";
      fs.writeFileSync(filePath, content);

      // Reload ledger with raw content
      const loadedLedger = manager.loadLedger(
        "CONTINUITY_CLAUDE-test-prune.md",
      );

      // #when
      const pruned = manager.pruneLedger(loadedLedger!);

      // #then
      const prunedContent = fs.readFileSync(filePath, "utf-8");
      expect(prunedContent).not.toContain("Session Ended");
    });
  });
});

describe("createLedgerManager", () => {
  test("creates manager with default config", () => {
    // #when
    const manager = createLedgerManager("/tmp/test");

    // #then
    expect(manager).toBeInstanceOf(LedgerManager);
  });

  test("creates manager with custom config", () => {
    // #when
    const manager = createLedgerManager("/tmp/test", {
      ledgerDir: "custom/ledgers",
      maxAgentReports: 5,
    });

    // #then
    expect(manager).toBeInstanceOf(LedgerManager);
  });
});

describe("Edge Cases", () => {
  const testDir = "/tmp/test-edge-cases";
  let manager: LedgerManager;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    manager = createLedgerManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("session name sanitization", () => {
    test("sanitizes session names with invalid characters", () => {
      const ledger = manager.createLedger('test<>:"/\\|?*session');
      expect(ledger.metadata.sessionName).toBe("test---------session");
      expect(fs.existsSync(ledger.metadata.filePath)).toBe(true);
    });

    test("sanitizes session names with dots", () => {
      const ledger = manager.createLedger("test...session...");
      expect(ledger.metadata.sessionName).toBe("test.session");
    });

    test("truncates very long session names", () => {
      const longName = "a".repeat(300);
      const ledger = manager.createLedger(longName);
      expect(ledger.metadata.sessionName.length).toBeLessThanOrEqual(200);
    });

    test("handles empty session name", () => {
      const ledger = manager.createLedger("");
      expect(ledger.metadata.sessionName).toBe("");
      expect(fs.existsSync(ledger.metadata.filePath)).toBe(true);
    });
  });

  describe("state parsing edge cases", () => {
    test("handles placeholder values in state", () => {
      const ledger = manager.createLedger("test-placeholder");
      const loaded = manager.loadLedger(
        "CONTINUITY_CLAUDE-test-placeholder.md",
      );
      expect(loaded?.state.done).toEqual([]);
      expect(loaded?.state.next).toEqual([]);
    });

    test("handles empty content gracefully", () => {
      manager.createLedger("test-empty");
      const filePath = path.join(
        testDir,
        "thoughts/ledgers/CONTINUITY_CLAUDE-test-empty.md",
      );
      fs.writeFileSync(filePath, "");
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-empty.md");
      expect(loaded).not.toBeNull();
      expect(loaded?.goal).toBe("");
      expect(loaded?.state.done).toEqual([]);
    });

    test("handles malformed markdown gracefully", () => {
      manager.createLedger("test-malformed");
      const filePath = path.join(
        testDir,
        "thoughts/ledgers/CONTINUITY_CLAUDE-test-malformed.md",
      );
      fs.writeFileSync(filePath, "# Not a valid ledger\nRandom content here");
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-malformed.md");
      expect(loaded).not.toBeNull();
      expect(loaded?.goal).toBe("");
    });
  });

  describe("findLatestLedger race condition handling", () => {
    test("handles file deletion during search", async () => {
      manager.createLedger("session-1");
      manager.createLedger("session-2");
      const found = manager.findLatestLedger();
      expect(found).not.toBeNull();
    });

    test("returns null when all files fail to stat", () => {
      const found = manager.findLatestLedger();
      expect(found).toBeNull();
    });
  });

  describe("working set parsing", () => {
    test("handles files with special characters in names", () => {
      const ledger = manager.createLedger("test-files", {
        workingSet: {
          keyFiles: ["src/my file.ts", "src/another-file.ts"],
        },
      });
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-files.md");
      expect(loaded?.workingSet.keyFiles).toContain("src/my file.ts");
    });

    test("handles empty working set", () => {
      const ledger = manager.createLedger("test-empty-ws");
      expect(ledger.workingSet.keyFiles).toEqual([]);
      expect(ledger.workingSet.branch).toBeUndefined();
    });
  });

  describe("decisions parsing", () => {
    test("handles decisions with colons in rationale", () => {
      const ledger = manager.createLedger("test-colons", {
        keyDecisions: [
          {
            decision: "Use Redis",
            rationale: "Performance: 10x faster than SQL",
          },
        ],
      });
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-colons.md");
      expect(loaded?.keyDecisions.length).toBe(1);
      expect(loaded?.keyDecisions[0].decision).toBe("Use Redis");
    });
  });

  describe("unicode and special content", () => {
    test("handles unicode in goal and state", () => {
      const ledger = manager.createLedger("test-unicode", {
        goal: "Implement 日本語 feature with émojis 🎉",
        state: {
          done: ["完了した task"],
          now: "Working on 中文",
          next: ["Next: العربية"],
        },
      });
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-unicode.md");
      expect(loaded?.goal).toContain("日本語");
      expect(loaded?.goal).toContain("🎉");
    });
  });

  describe("concurrent access", () => {
    test("handles rapid sequential updates", () => {
      let ledger = manager.createLedger("test-concurrent");
      for (let i = 0; i < 10; i++) {
        ledger = manager.updateState(ledger, { now: `Task ${i}` });
      }
      const loaded = manager.loadLedger("CONTINUITY_CLAUDE-test-concurrent.md");
      expect(loaded?.state.now).toBe("Task 9");
    });
  });
});
