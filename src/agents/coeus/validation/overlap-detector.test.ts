import { describe, it, expect } from "bun:test";
import { detectOverlaps, type FileOverlap } from "./overlap-detector";
import type { SubPlan } from "../schemas/sub-plan-schema";

function makeSubPlan(domain: string, filesTouched: string[][]): SubPlan {
  return {
    domain,
    domain_description: `${domain} domain`,
    tasks: filesTouched.map((files, i) => ({
      id: `${domain}-task-${i}`,
      title: `Task ${i}`,
      description: `Task ${i} description`,
      depends_on: [],
      category: "quick",
      skills: [],
      files_touched: files,
      acceptance_criteria: ["done"],
    })),
    wave_assignments: {},
    constraints_acknowledged: true,
    source_sub_planner: "test",
  };
}

describe("overlap-detector", () => {
  describe("detectOverlaps", () => {
    describe("basic overlap detection", () => {
      //#given two sub-plans sharing one file
      //#when detecting overlaps
      //#then returns single overlap with both domains
      it("detects overlap between two sub-plans", () => {
        const planA = makeSubPlan("A", [["src/auth.ts", "src/types.ts"]]);
        const planB = makeSubPlan("B", [["src/types.ts", "src/api.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].file).toBe("src/types.ts");
        expect(overlaps[0].sub_plans.sort()).toEqual(["A", "B"]);
      });

      //#given three sub-plans all touching same file
      //#when detecting overlaps
      //#then returns overlap with all three domains
      it("detects overlap across three sub-plans", () => {
        const planA = makeSubPlan("A", [["src/shared.ts"]]);
        const planB = makeSubPlan("B", [["src/shared.ts"]]);
        const planC = makeSubPlan("C", [["src/shared.ts", "src/other.ts"]]);

        const overlaps = detectOverlaps([planA, planB, planC]);

        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].file).toBe("src/shared.ts");
        expect(overlaps[0].sub_plans.sort()).toEqual(["A", "B", "C"]);
      });
    });

    describe("no overlaps", () => {
      //#given non-overlapping sub-plans
      //#when detecting overlaps
      //#then returns empty array
      it("returns empty for non-overlapping sub-plans", () => {
        const planA = makeSubPlan("A", [["src/auth.ts"]]);
        const planB = makeSubPlan("B", [["src/api.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toEqual([]);
      });

      //#given empty sub-plans array
      //#when detecting overlaps
      //#then returns empty array
      it("returns empty for empty input", () => {
        const overlaps = detectOverlaps([]);
        expect(overlaps).toEqual([]);
      });

      //#given sub-plans with empty tasks
      //#when detecting overlaps
      //#then returns empty array
      it("returns empty for sub-plans with no files", () => {
        const planA = makeSubPlan("A", [[]]);
        const planB = makeSubPlan("B", [[]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toEqual([]);
      });

      //#given single sub-plan
      //#when detecting overlaps
      //#then returns empty (no overlap possible)
      it("returns empty for single sub-plan", () => {
        const planA = makeSubPlan("A", [["src/auth.ts", "src/types.ts"]]);

        const overlaps = detectOverlaps([planA]);

        expect(overlaps).toEqual([]);
      });
    });

    describe("multiple tasks per sub-plan", () => {
      //#given sub-plans with multiple tasks touching different files
      //#when detecting overlaps
      //#then aggregates files across tasks within each sub-plan
      it("aggregates files across tasks in same sub-plan", () => {
        const planA = makeSubPlan("A", [["src/auth.ts"], ["src/types.ts"]]);
        const planB = makeSubPlan("B", [["src/api.ts"], ["src/types.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].file).toBe("src/types.ts");
        expect(overlaps[0].sub_plans.sort()).toEqual(["A", "B"]);
      });
    });

    describe("multiple overlapping files", () => {
      //#given sub-plans sharing multiple files
      //#when detecting overlaps
      //#then returns all overlapping files
      it("detects multiple overlapping files", () => {
        const planA = makeSubPlan("A", [["src/types.ts", "src/utils.ts"]]);
        const planB = makeSubPlan("B", [["src/types.ts", "src/utils.ts", "src/api.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toHaveLength(2);
        const files = overlaps.map((o) => o.file).sort();
        expect(files).toEqual(["src/types.ts", "src/utils.ts"]);
      });
    });

    describe("deduplication", () => {
      //#given sub-plan with duplicate files across tasks
      //#when detecting overlaps
      //#then domain appears only once per overlap
      it("deduplicates files within same sub-plan", () => {
        const planA = makeSubPlan("A", [["src/types.ts"], ["src/types.ts"]]);
        const planB = makeSubPlan("B", [["src/types.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].sub_plans).toEqual(["A", "B"]);
      });
    });

    describe("return shape", () => {
      //#given overlapping sub-plans
      //#when detecting overlaps
      //#then each result has file and sub_plans fields
      it("returns correct FileOverlap shape", () => {
        const planA = makeSubPlan("A", [["src/shared.ts"]]);
        const planB = makeSubPlan("B", [["src/shared.ts"]]);

        const overlaps = detectOverlaps([planA, planB]);

        expect(overlaps[0]).toHaveProperty("file");
        expect(overlaps[0]).toHaveProperty("sub_plans");
        expect(typeof overlaps[0].file).toBe("string");
        expect(Array.isArray(overlaps[0].sub_plans)).toBe(true);
      });
    });
  });
});
