import { describe, it, expect } from "bun:test";
import {
  ComplexityScore,
  DecompositionDecision,
  DECOMPOSITION_THRESHOLD,
  MIN_TASKS_PER_SUB_PLAN,
  MIN_ACCEPTANCE_CRITERIA_PER_TASK,
} from "./types";

describe("Coeus Types", () => {
  describe("ComplexityScore interface", () => {
    it("should allow valid ComplexityScore objects", () => {
      const score: ComplexityScore = {
        total: 45,
        concern_count: 3,
        file_count_estimate: 12,
        cross_domain: true,
        reasoning: "Multi-domain problem spanning auth, frontend, and database",
      };

      expect(score.total).toBe(45);
      expect(score.concern_count).toBe(3);
      expect(score.file_count_estimate).toBe(12);
      expect(score.cross_domain).toBe(true);
      expect(typeof score.reasoning).toBe("string");
    });

    it("should have all required properties", () => {
      const score: ComplexityScore = {
        total: 0,
        concern_count: 0,
        file_count_estimate: 0,
        cross_domain: false,
        reasoning: "",
      };

      expect(Object.keys(score).length).toBe(5);
      expect(score).toHaveProperty("total");
      expect(score).toHaveProperty("concern_count");
      expect(score).toHaveProperty("file_count_estimate");
      expect(score).toHaveProperty("cross_domain");
      expect(score).toHaveProperty("reasoning");
    });
  });

  describe("DecompositionDecision interface", () => {
    it("should allow valid DecompositionDecision objects", () => {
      const decision: DecompositionDecision = {
        should_decompose: true,
        domains: ["auth", "frontend", "database"],
        strategy: "domain",
        rationale: "Score exceeds threshold, multiple domains identified",
      };

      expect(decision.should_decompose).toBe(true);
      expect(decision.domains).toEqual(["auth", "frontend", "database"]);
      expect(decision.strategy).toBe("domain");
      expect(typeof decision.rationale).toBe("string");
    });

    it("should support all strategy types", () => {
      const strategies: Array<"domain" | "feature" | "hybrid"> = [
        "domain",
        "feature",
        "hybrid",
      ];

      strategies.forEach((strategy) => {
        const decision: DecompositionDecision = {
          should_decompose: true,
          domains: ["test"],
          strategy,
          rationale: "Test",
        };
        expect(decision.strategy).toBe(strategy);
      });
    });

    it("should have all required properties", () => {
      const decision: DecompositionDecision = {
        should_decompose: false,
        domains: [],
        strategy: "feature",
        rationale: "",
      };

      expect(Object.keys(decision).length).toBe(4);
      expect(decision).toHaveProperty("should_decompose");
      expect(decision).toHaveProperty("domains");
      expect(decision).toHaveProperty("strategy");
      expect(decision).toHaveProperty("rationale");
    });
  });

  describe("Constants", () => {
    it("DECOMPOSITION_THRESHOLD should equal 40", () => {
      expect(DECOMPOSITION_THRESHOLD).toBe(40);
    });

    it("MIN_TASKS_PER_SUB_PLAN should equal 3", () => {
      expect(MIN_TASKS_PER_SUB_PLAN).toBe(3);
    });

    it("MIN_ACCEPTANCE_CRITERIA_PER_TASK should equal 2", () => {
      expect(MIN_ACCEPTANCE_CRITERIA_PER_TASK).toBe(2);
    });

    it("constants should be numbers", () => {
      expect(typeof DECOMPOSITION_THRESHOLD).toBe("number");
      expect(typeof MIN_TASKS_PER_SUB_PLAN).toBe("number");
      expect(typeof MIN_ACCEPTANCE_CRITERIA_PER_TASK).toBe("number");
    });

    it("constants should be positive integers", () => {
      expect(DECOMPOSITION_THRESHOLD).toBeGreaterThan(0);
      expect(MIN_TASKS_PER_SUB_PLAN).toBeGreaterThan(0);
      expect(MIN_ACCEPTANCE_CRITERIA_PER_TASK).toBeGreaterThan(0);
      expect(Number.isInteger(DECOMPOSITION_THRESHOLD)).toBe(true);
      expect(Number.isInteger(MIN_TASKS_PER_SUB_PLAN)).toBe(true);
      expect(Number.isInteger(MIN_ACCEPTANCE_CRITERIA_PER_TASK)).toBe(true);
    });
  });
});
