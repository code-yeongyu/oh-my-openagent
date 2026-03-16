import { describe, test, expect } from "bun:test"
import { serializeToSisyphusMarkdown } from "./plan-serializer"
import type { MergedPlan } from "../schemas/merged-plan-schema"

describe("serializeToSisyphusMarkdown", () => {
  test("output contains required sections", () => {
    //#given
    const plan: MergedPlan = {
      title: "Test Plan",
      context: "Test context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "Do task 1",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file1.ts"],
          acceptance_criteria: ["AC1"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1"] }],
      dependency_graph: { T1: [] },
      global_constraints: "No constraints",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("## TL;DR")
    expect(result).toContain("## TODOs")
    expect(result).toContain("## Execution Strategy")
    expect(result).toContain("## Context")
  })

  test("TODOs organized by wave with correct numbering", () => {
    //#given
    const plan: MergedPlan = {
      title: "Multi-wave Plan",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "First task",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file1.ts"],
          acceptance_criteria: ["AC1"],
        },
        {
          id: "T2",
          title: "Task 2",
          description: "Second task",
          depends_on: ["T1"],
          category: "quick",
          skills: [],
          files_touched: ["file2.ts"],
          acceptance_criteria: ["AC2"],
        },
      ],
      waves: [
        { wave: 1, task_ids: ["T1"] },
        { wave: 2, task_ids: ["T2"] },
      ],
      dependency_graph: { T1: [], T2: ["T1"] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("### Wave 1")
    expect(result).toContain("### Wave 2")
    expect(result.indexOf("### Wave 1")).toBeLessThan(result.indexOf("### Wave 2"))
  })

  test("each task has acceptance criteria in checkbox format", () => {
    //#given
    const plan: MergedPlan = {
      title: "Test",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "Do it",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file.ts"],
          acceptance_criteria: ["Criterion 1", "Criterion 2"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1"] }],
      dependency_graph: { T1: [] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("**Acceptance Criteria**:")
    expect(result).toContain("- [ ] Criterion 1")
    expect(result).toContain("- [ ] Criterion 2")
  })

  test("tasks within wave appear in order of IDs", () => {
    //#given
    const plan: MergedPlan = {
      title: "Test",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "First",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file1.ts"],
          acceptance_criteria: ["AC1"],
        },
        {
          id: "T2",
          title: "Task 2",
          description: "Second",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file2.ts"],
          acceptance_criteria: ["AC2"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1", "T2"] }],
      dependency_graph: { T1: [], T2: [] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    const t1Index = result.indexOf("- [ ] T1.")
    const t2Index = result.indexOf("- [ ] T2.")
    expect(t1Index).toBeLessThan(t2Index)
  })

  test("single-wave plan serializes correctly", () => {
    //#given
    const plan: MergedPlan = {
      title: "Single Wave",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Only Task",
          description: "Do it",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file.ts"],
          acceptance_criteria: ["AC1"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1"] }],
      dependency_graph: { T1: [] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("### Wave 1")
    expect(result).not.toContain("### Wave 2")
    expect(result).toContain("- [ ] T1. Only Task")
  })

  test("multi-wave plan (3 waves) serializes correctly", () => {
    //#given
    const plan: MergedPlan = {
      title: "Three Waves",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "First",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file1.ts"],
          acceptance_criteria: ["AC1"],
        },
        {
          id: "T2",
          title: "Task 2",
          description: "Second",
          depends_on: ["T1"],
          category: "quick",
          skills: [],
          files_touched: ["file2.ts"],
          acceptance_criteria: ["AC2"],
        },
        {
          id: "T3",
          title: "Task 3",
          description: "Third",
          depends_on: ["T2"],
          category: "quick",
          skills: [],
          files_touched: ["file3.ts"],
          acceptance_criteria: ["AC3"],
        },
      ],
      waves: [
        { wave: 1, task_ids: ["T1"] },
        { wave: 2, task_ids: ["T2"] },
        { wave: 3, task_ids: ["T3"] },
      ],
      dependency_graph: { T1: [], T2: ["T1"], T3: ["T2"] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("### Wave 1")
    expect(result).toContain("### Wave 2")
    expect(result).toContain("### Wave 3")
    const w1 = result.indexOf("### Wave 1")
    const w2 = result.indexOf("### Wave 2")
    const w3 = result.indexOf("### Wave 3")
    expect(w1).toBeLessThan(w2)
    expect(w2).toBeLessThan(w3)
  })

  test("task with must_not_do section renders it", () => {
    //#given
    const plan: MergedPlan = {
      title: "Test",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "Do it",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file.ts"],
          acceptance_criteria: ["AC1"],
          must_not_do: ["Don't do this", "Avoid that"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1"] }],
      dependency_graph: { T1: [] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("**Must NOT do**:")
    expect(result).toContain("- Don't do this")
    expect(result).toContain("- Avoid that")
  })

  test("task without must_not_do section omits it cleanly", () => {
    //#given
    const plan: MergedPlan = {
      title: "Test",
      context: "Context",
      domains: ["domain1"],
      tasks: [
        {
          id: "T1",
          title: "Task 1",
          description: "Do it",
          depends_on: [],
          category: "quick",
          skills: [],
          files_touched: ["file.ts"],
          acceptance_criteria: ["AC1"],
        },
      ],
      waves: [{ wave: 1, task_ids: ["T1"] }],
      dependency_graph: { T1: [] },
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).not.toContain("**Must NOT do**:")
  })

  test("empty tasks array produces minimal valid output", () => {
    //#given
    const plan: MergedPlan = {
      title: "Empty Plan",
      context: "Context",
      domains: ["domain1"],
      tasks: [],
      waves: [],
      dependency_graph: {},
      global_constraints: "None",
    }

    //#when
    const result = serializeToSisyphusMarkdown(plan)

    //#then
    expect(result).toContain("# Empty Plan")
    expect(result).toContain("## TL;DR")
    expect(result).toContain("## Context")
    expect(result).toContain("## TODOs")
  })
})
