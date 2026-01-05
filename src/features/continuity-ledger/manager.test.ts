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
