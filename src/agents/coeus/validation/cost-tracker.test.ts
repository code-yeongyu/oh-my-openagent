import { describe, it, expect, beforeEach } from "bun:test";
import { CostTracker } from "./cost-tracker";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe("addUsage", () => {
    //#given empty tracker
    //#when adding usage for agent-1 with 100 tokens
    //#then should track the usage
    it("tracks usage for single agent", () => {
      tracker.addUsage("agent-1", 100);
      expect(tracker.getTotalUsage()).toBe(100);
    });

    //#given tracker with agent-1 at 100 tokens
    //#when adding 50 more tokens for agent-1
    //#then should accumulate usage
    it("accumulates usage for same agent", () => {
      tracker.addUsage("agent-1", 100);
      tracker.addUsage("agent-1", 50);
      expect(tracker.getTotalUsage()).toBe(150);
    });

    //#given empty tracker
    //#when adding usage for 3 different agents
    //#then should track all agents separately
    it("tracks multiple agents independently", () => {
      tracker.addUsage("agent-1", 100);
      tracker.addUsage("agent-2", 200);
      tracker.addUsage("agent-3", 150);
      expect(tracker.getTotalUsage()).toBe(450);
    });
  });

  describe("getTotalUsage", () => {
    //#given empty tracker
    //#when getting total usage
    //#then should return 0
    it("returns 0 for empty tracker", () => {
      expect(tracker.getTotalUsage()).toBe(0);
    });

    //#given tracker with multiple agents
    //#when getting total usage
    //#then should return sum of all agents
    it("returns sum of all agent usage", () => {
      tracker.addUsage("agent-1", 100);
      tracker.addUsage("agent-2", 200);
      tracker.addUsage("agent-3", 150);
      expect(tracker.getTotalUsage()).toBe(450);
    });
  });

  describe("isOverBudget", () => {
    //#given tracker with 300 tokens used
    //#when checking budget of 500
    //#then should return false (under budget)
    it("returns false when under budget", () => {
      tracker.addUsage("agent-1", 300);
      expect(tracker.isOverBudget(500)).toBe(false);
    });

    //#given tracker with 500 tokens used
    //#when checking budget of 500
    //#then should return false (at budget)
    it("returns false when at budget", () => {
      tracker.addUsage("agent-1", 500);
      expect(tracker.isOverBudget(500)).toBe(false);
    });

    //#given tracker with 600 tokens used
    //#when checking budget of 500
    //#then should return true (over budget)
    it("returns true when over budget", () => {
      tracker.addUsage("agent-1", 600);
      expect(tracker.isOverBudget(500)).toBe(true);
    });

    //#given tracker with 0 tokens
    //#when checking budget of 0
    //#then should return false (at budget)
    it("handles zero budget", () => {
      expect(tracker.isOverBudget(0)).toBe(false);
    });
  });

  describe("getReport", () => {
    //#given empty tracker
    //#when getting report
    //#then should return total 0 and empty perAgent
    it("returns empty report for new tracker", () => {
      const report = tracker.getReport();
      expect(report.total).toBe(0);
      expect(report.perAgent).toEqual({});
    });

    //#given tracker with 3 agents
    //#when getting report
    //#then should show total and per-agent breakdown
    it("returns accurate per-agent breakdown", () => {
      tracker.addUsage("agent-1", 100);
      tracker.addUsage("agent-2", 200);
      tracker.addUsage("agent-3", 150);

      const report = tracker.getReport();
      expect(report.total).toBe(450);
      expect(report.perAgent).toEqual({
        "agent-1": 100,
        "agent-2": 200,
        "agent-3": 150,
      });
    });

    //#given tracker with agent-1 receiving multiple additions
    //#when getting report
    //#then should show accumulated total for that agent
    it("accumulates per-agent totals correctly", () => {
      tracker.addUsage("agent-1", 100);
      tracker.addUsage("agent-1", 50);
      tracker.addUsage("agent-2", 200);

      const report = tracker.getReport();
      expect(report.total).toBe(350);
      expect(report.perAgent["agent-1"]).toBe(150);
      expect(report.perAgent["agent-2"]).toBe(200);
    });
  });
});
