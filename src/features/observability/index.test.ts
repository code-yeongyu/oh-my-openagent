import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TokenTracker } from "./TokenTracker";
import { DecisionJournal } from "./DecisionJournal";
import { WorkSummary } from "./WorkSummary";

describe("Observability System", () => {
  describe("TokenTracker", () => {
    test("tracks usage per agent", () => {
      const tracker = new TokenTracker();
      tracker.track("agent-1", "input", 100);
      tracker.track("agent-1", "output", 50);
      
      const usage = tracker.getUsage("agent-1");
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
    });

    test("accumulates usage", () => {
      const tracker = new TokenTracker();
      tracker.track("agent-1", "input", 100);
      tracker.track("agent-1", "input", 50);
      
      const usage = tracker.getUsage("agent-1");
      expect(usage.inputTokens).toBe(150);
    });

    test("estimates costs correctly", () => {
      const tracker = new TokenTracker();
      tracker.track("agent-sonnet", "input", 1000000, "claude-3-5-sonnet");
      tracker.track("agent-sonnet", "output", 1000000, "claude-3-5-sonnet");
      
      const cost = tracker.estimateCost("agent-sonnet");
      expect(cost).toBeCloseTo(18.00, 2);
    });
  });

  describe("DecisionJournal", () => {
    const testLogDir = path.join(os.tmpdir(), "sisyphus-test-logs");

    beforeEach(() => {
      if (fs.existsSync(testLogDir)) {
        fs.rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testLogDir)) {
        fs.rmSync(testLogDir, { recursive: true, force: true });
      }
    });

    test("logs decision to file", async () => {
      const journal = new DecisionJournal({ logDir: testLogDir });
      await journal.log({
        agentId: "agent-1",
        taskId: "task-1",
        decision: "chose option A",
        reasoning: "it was better"
      });

      const files = fs.readdirSync(testLogDir);
      expect(files.length).toBe(1);
      
      const content = fs.readFileSync(path.join(testLogDir, files[0]), "utf-8");
      const entry = JSON.parse(content);
      expect(entry.agentId).toBe("agent-1");
      expect(entry.decision).toBe("chose option A");
    });
  });

  describe("WorkSummary", () => {
    test("generates summary", () => {
      const tracker = new TokenTracker();
      tracker.track("agent-1", "input", 100, "claude-3-5-sonnet");
      
      const journal = new DecisionJournal({ logDir: "/tmp" });
      
      const summary = new WorkSummary(tracker, journal);
      const report = summary.generate();
      
      expect(report).toContain("Token Usage");
      expect(report).toContain("agent-1");
    });
  });
});
