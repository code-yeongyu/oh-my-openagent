import { describe, it, expect } from "bun:test";
import { validateSubPlan } from "./sub-plan-validator";
import { MIN_TASKS_PER_SUB_PLAN, MIN_ACCEPTANCE_CRITERIA_PER_TASK } from "../types";

describe("sub-plan-validator", () => {
  describe("validateSubPlan", () => {
    //#given a valid sub-plan with 3+ tasks, 2+ AC each, constraints_acknowledged=true
    //#when validating
    //#then returns valid=true, errors=[]
    it("accepts valid sub-plan with 3 tasks and 2 AC each", () => {
      const validPlan = {
        domain: "backend",
        domain_description: "Backend API development",
        tasks: [
          {
            id: "task-1",
            title: "Setup database",
            description: "Initialize PostgreSQL",
            depends_on: [],
            category: "infrastructure",
            skills: ["sql"],
            files_touched: ["db/schema.sql"],
            acceptance_criteria: ["Database created", "Tables initialized"],
          },
          {
            id: "task-2",
            title: "Create API endpoints",
            description: "REST endpoints",
            depends_on: ["task-1"],
            category: "api",
            skills: ["typescript"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["GET /users works", "POST /users works"],
          },
          {
            id: "task-3",
            title: "Add authentication",
            description: "JWT auth",
            depends_on: ["task-2"],
            category: "security",
            skills: ["jwt"],
            files_touched: ["src/auth.ts"],
            acceptance_criteria: ["Token generation works", "Token validation works"],
          },
        ],
        wave_assignments: { wave1: 2, wave2: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(validPlan);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    //#given a sub-plan with exactly 3 tasks and 2 AC each (boundary)
    //#when validating
    //#then passes (boundary condition)
    it("accepts sub-plan with exactly MIN_TASKS_PER_SUB_PLAN tasks", () => {
      const plan = {
        domain: "frontend",
        domain_description: "Frontend UI",
        tasks: Array.from({ length: MIN_TASKS_PER_SUB_PLAN }, (_, i) => ({
          id: `task-${i}`,
          title: `Task ${i}`,
          description: `Description ${i}`,
          depends_on: [],
          category: "ui",
          skills: ["react"],
          files_touched: [`src/component-${i}.tsx`],
          acceptance_criteria: ["Criterion 1", "Criterion 2"],
        })),
        wave_assignments: { wave1: 3 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    //#given a sub-plan with 1 task
    //#when validating
    //#then returns valid=false with error mentioning "at least 3 tasks"
    it("rejects sub-plan with 1 task", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Single task",
            description: "Only one task",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least 3 tasks"))).toBe(true);
    });

    //#given a sub-plan with 2 tasks
    //#when validating
    //#then returns valid=false with error mentioning "at least 3 tasks"
    it("rejects sub-plan with 2 tasks", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 2 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least 3 tasks"))).toBe(true);
    });

    //#given a task with 0 acceptance criteria
    //#when validating
    //#then returns valid=false with Zod error (schema rejects empty array)
    it("rejects task with 0 acceptance criteria", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: [],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-3",
            title: "Task 3",
            description: "Third",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 3 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    //#given a task with 1 acceptance criterion
    //#when validating
    //#then returns valid=false with custom validation error
    it("rejects task with 1 acceptance criterion", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works"],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-3",
            title: "Task 3",
            description: "Third",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 3 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("task-1"))).toBe(true);
      expect(result.errors.some((e) => e.includes("at least 2"))).toBe(true);
    });

    //#given a sub-plan with constraints_acknowledged=false
    //#when validating
    //#then returns valid=false with error mentioning constraints
    it("rejects sub-plan with constraints_acknowledged=false", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-3",
            title: "Task 3",
            description: "Third",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 3 },
        constraints_acknowledged: false,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("constraints"))).toBe(true);
    });

    //#given completely invalid input (not an object)
    //#when validating
    //#then returns valid=false with Zod errors
    it("rejects non-object input", () => {
      const result = validateSubPlan("not an object");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    //#given invalid input (null)
    //#when validating
    //#then returns valid=false with Zod errors
    it("rejects null input", () => {
      const result = validateSubPlan(null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    //#given a sub-plan with multiple errors (few tasks + no constraints)
    //#when validating
    //#then collects all errors
    it("collects multiple errors at once", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 2 },
        constraints_acknowledged: false,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes("at least 3 tasks"))).toBe(true);
      expect(result.errors.some((e) => e.includes("constraints"))).toBe(true);
    });

    //#given a sub-plan missing required fields
    //#when validating
    //#then returns valid=false with Zod errors
    it("rejects sub-plan with missing required fields", () => {
      const plan = {
        domain: "backend",
        // missing domain_description, tasks, wave_assignments, constraints_acknowledged, source_sub_planner
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    //#given a task with missing id field
    //#when validating
    //#then returns valid=false with Zod errors
    it("rejects task with missing id", () => {
      const plan = {
        domain: "backend",
        domain_description: "Backend",
        tasks: [
          {
            // missing id
            title: "Task 1",
            description: "First",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
          {
            id: "task-3",
            title: "Task 3",
            description: "Third",
            depends_on: [],
            category: "api",
            skills: ["ts"],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Works", "Tested"],
          },
        ],
        wave_assignments: { wave1: 3 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus",
      };

      const result = validateSubPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
