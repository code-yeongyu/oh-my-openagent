import { describe, it, expect } from "bun:test";
import { validateMergedPlan } from "./final-validator";
import type { MergedPlan } from "../schemas/merged-plan-schema";
import type { Task } from "../schemas/sub-plan-schema";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: `Task ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    depends_on: [],
    category: "quick",
    skills: [],
    files_touched: [],
    acceptance_criteria: ["criterion 1"],
    ...overrides,
  };
}

function makePlan(overrides: Partial<MergedPlan> = {}): MergedPlan {
  const tasks = overrides.tasks ?? [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
  return {
    title: "Test Plan",
    context: "Test context",
    domains: ["frontend"],
    tasks,
    waves: overrides.waves ?? [{ wave: 1, task_ids: tasks.map((t) => t.id) }],
    dependency_graph: overrides.dependency_graph ?? { t1: [], t2: [] },
    global_constraints: "none",
    ...overrides,
  };
}

describe("final-validator", () => {
  describe("validateMergedPlan", () => {
    describe("valid plans", () => {
      //#given a well-formed merged plan with all checks passing
      //#when validating
      //#then returns valid=true, no errors, no warnings
      it("accepts a valid merged plan", () => {
        const plan = makePlan();

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
      });
    });

    describe("schema validation", () => {
      //#given a plan missing required fields
      //#when validating
      //#then returns valid=false with schema errors
      it("rejects plan failing schema validation", () => {
        const bad = { title: "x" } as unknown as MergedPlan;

        const result = validateMergedPlan(bad);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe("cycle detection", () => {
      //#given a plan with dependency cycle A→B→A
      //#when validating
      //#then returns valid=false with error mentioning cycle
      it("detects dependency cycles", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "A", depends_on: ["B"] }),
            makeTask({ id: "B", depends_on: ["A"] }),
          ],
          waves: [{ wave: 1, task_ids: ["A", "B"] }],
          dependency_graph: { A: ["B"], B: ["A"] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
      });
    });

    describe("wave ordering", () => {
      //#given task in wave 1 depending on task in wave 2
      //#when validating
      //#then returns valid=false with wave ordering error
      it("rejects task in wave before its dependency", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "t1", depends_on: ["t2"] }),
            makeTask({ id: "t2" }),
          ],
          waves: [
            { wave: 1, task_ids: ["t1"] },
            { wave: 2, task_ids: ["t2"] },
          ],
          dependency_graph: { t1: ["t2"], t2: [] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("t1") && e.includes("t2") && e.includes("wave"))).toBe(true);
      });

      //#given task depending on task in earlier wave
      //#when validating
      //#then passes wave ordering check
      it("accepts correct wave ordering", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "t1" }),
            makeTask({ id: "t2", depends_on: ["t1"] }),
          ],
          waves: [
            { wave: 1, task_ids: ["t1"] },
            { wave: 2, task_ids: ["t2"] },
          ],
          dependency_graph: { t1: [], t2: ["t1"] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(true);
      });
    });

    describe("task completeness", () => {
      //#given a task with empty acceptance_criteria
      //#when validating
      //#then returns valid=false with missing AC error
      it("rejects task missing acceptance criteria", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "t1", acceptance_criteria: [] }),
          ],
          waves: [{ wave: 1, task_ids: ["t1"] }],
          dependency_graph: { t1: [] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("t1") && e.includes("acceptance criteria"))).toBe(true);
      });
    });

    describe("orphan tasks", () => {
      //#given wave referencing task_id not in tasks array
      //#when validating
      //#then returns valid=false with unknown task error
      it("detects wave referencing unknown task", () => {
        const plan = makePlan({
          tasks: [makeTask({ id: "t1" })],
          waves: [{ wave: 1, task_ids: ["t1", "ghost"] }],
          dependency_graph: { t1: [] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("ghost"))).toBe(true);
      });
    });

    describe("unassigned tasks", () => {
      //#given a task not assigned to any wave
      //#when validating
      //#then returns valid=true but with warning
      it("warns about unassigned tasks", () => {
        const plan = makePlan({
          tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
          waves: [{ wave: 1, task_ids: ["t1"] }],
          dependency_graph: { t1: [], t2: [] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.includes("t2") && w.includes("not assigned"))).toBe(true);
      });
    });

    describe("file overlap in same wave", () => {
      //#given two tasks in same wave touching same file
      //#when validating
      //#then returns valid=true but with parallel conflict warning
      it("warns about same-wave file overlap", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "t1", files_touched: ["src/shared.ts"] }),
            makeTask({ id: "t2", files_touched: ["src/shared.ts"] }),
          ],
          waves: [{ wave: 1, task_ids: ["t1", "t2"] }],
          dependency_graph: { t1: [], t2: [] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.includes("src/shared.ts") && w.includes("parallel conflict"))).toBe(true);
      });

      //#given two tasks in different waves touching same file
      //#when validating
      //#then no warning (sequential execution)
      it("no warning for cross-wave file overlap", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "t1", files_touched: ["src/shared.ts"] }),
            makeTask({ id: "t2", files_touched: ["src/shared.ts"], depends_on: ["t1"] }),
          ],
          waves: [
            { wave: 1, task_ids: ["t1"] },
            { wave: 2, task_ids: ["t2"] },
          ],
          dependency_graph: { t1: [], t2: ["t1"] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(true);
        expect(result.warnings).toEqual([]);
      });
    });

    describe("multiple errors", () => {
      //#given plan with cycle AND missing AC
      //#when validating
      //#then all errors reported
      it("collects multiple errors", () => {
        const plan = makePlan({
          tasks: [
            makeTask({ id: "A", depends_on: ["B"], acceptance_criteria: [] }),
            makeTask({ id: "B", depends_on: ["A"] }),
          ],
          waves: [{ wave: 1, task_ids: ["A", "B"] }],
          dependency_graph: { A: ["B"], B: ["A"] },
        });

        const result = validateMergedPlan(plan);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
        expect(result.errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
        expect(result.errors.some((e) => e.includes("acceptance criteria"))).toBe(true);
      });
    });
  });
});
