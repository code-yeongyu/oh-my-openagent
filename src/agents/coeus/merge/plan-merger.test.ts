import { describe, expect, it } from "bun:test"
import type { SubPlan } from "../schemas/sub-plan-schema"
import { mergeSubPlans } from "./plan-merger"

function makeTask(overrides: Partial<SubPlan["tasks"][0]> & { id: string; title: string }) {
  return {
    description: overrides.title,
    depends_on: [],
    category: "implementation",
    skills: ["typescript"],
    files_touched: [],
    acceptance_criteria: ["done"],
    ...overrides,
  }
}

function makePlan(domain: string, tasks: SubPlan["tasks"]): SubPlan {
  const wave_assignments: Record<string, number> = {}
  for (const t of tasks) wave_assignments[t.id] = 1
  return {
    domain,
    domain_description: `${domain} domain`,
    tasks,
    wave_assignments,
    constraints_acknowledged: true,
    source_sub_planner: "test",
  }
}

describe("mergeSubPlans", () => {
  //#given empty sub-plans array
  //#when merging
  //#then returns empty merged plan
  it("handles empty sub-plans array gracefully", () => {
    const result = mergeSubPlans([], "no constraints")

    expect(result.tasks).toEqual([])
    expect(result.waves).toEqual([])
    expect(result.domains).toEqual([])
    expect(result.dependency_graph).toEqual({})
    expect(result.global_constraints).toBe("no constraints")
  })

  //#given single sub-plan with 3 tasks
  //#when merging
  //#then all tasks namespaced, waves preserved
  it("merges single sub-plan (degenerate case)", () => {
    const plan = makePlan("auth", [
      makeTask({ id: "T1", title: "Setup auth", files_touched: ["auth.ts"] }),
      makeTask({ id: "T2", title: "Add login", depends_on: ["T1"], files_touched: ["login.ts"] }),
      makeTask({ id: "T3", title: "Add logout", depends_on: ["T1"], files_touched: ["logout.ts"] }),
    ])

    const result = mergeSubPlans([plan], "be safe")

    expect(result.domains).toEqual(["auth"])
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks.map((t) => t.id)).toEqual(["auth-T1", "auth-T2", "auth-T3"])
    expect(result.tasks[1].depends_on).toEqual(["auth-T1"])
    expect(result.global_constraints).toBe("be safe")
  })

  //#given 2 non-overlapping sub-plans with 3 tasks each
  //#when merging
  //#then 6 tasks total, IDs namespaced by domain
  it("merges 2 non-overlapping sub-plans correctly (6 tasks from 3+3)", () => {
    const authPlan = makePlan("auth", [
      makeTask({ id: "T1", title: "Auth setup", files_touched: ["auth.ts"] }),
      makeTask({ id: "T2", title: "Auth login", depends_on: ["T1"], files_touched: ["login.ts"] }),
      makeTask({ id: "T3", title: "Auth test", depends_on: ["T2"], files_touched: ["auth.test.ts"] }),
    ])
    const dbPlan = makePlan("db", [
      makeTask({ id: "T1", title: "DB setup", files_touched: ["db.ts"] }),
      makeTask({ id: "T2", title: "DB migrate", depends_on: ["T1"], files_touched: ["migrate.ts"] }),
      makeTask({ id: "T3", title: "DB seed", depends_on: ["T2"], files_touched: ["seed.ts"] }),
    ])

    const result = mergeSubPlans([authPlan, dbPlan], "global")

    expect(result.tasks).toHaveLength(6)
    expect(result.domains).toEqual(["auth", "db"])

    const ids = result.tasks.map((t) => t.id)
    expect(ids).toContain("auth-T1")
    expect(ids).toContain("db-T1")
    expect(ids).not.toContain("T1")
  })

  //#given 2 non-overlapping sub-plans
  //#when merging
  //#then task IDs are namespaced by domain
  it("namespaces all task IDs by domain", () => {
    const plan = makePlan("api", [
      makeTask({ id: "setup", title: "Setup" }),
      makeTask({ id: "routes", title: "Routes", depends_on: ["setup"] }),
    ])

    const result = mergeSubPlans([plan], "none")

    for (const task of result.tasks) {
      expect(task.id).toMatch(/^api-/)
    }
    expect(result.tasks[1].depends_on).toEqual(["api-setup"])
  })

  //#given merged plan with sequential deps
  //#when checking wave numbers
  //#then waves are sequential with no gaps
  it("assigns sequential wave numbers with no gaps", () => {
    const plan = makePlan("core", [
      makeTask({ id: "T1", title: "Base" }),
      makeTask({ id: "T2", title: "Mid", depends_on: ["T1"] }),
      makeTask({ id: "T3", title: "Top", depends_on: ["T2"] }),
    ])

    const result = mergeSubPlans([plan], "none")

    const waveNums = result.waves.map((w) => w.wave)
    expect(waveNums).toEqual([1, 2, 3])
    expect(result.waves[0].task_ids).toEqual(["core-T1"])
    expect(result.waves[1].task_ids).toEqual(["core-T2"])
    expect(result.waves[2].task_ids).toEqual(["core-T3"])
  })

  //#given 2 plans where tasks touch same files
  //#when merging
  //#then cross-plan file overlap creates dependency edge
  it("creates cross-plan dependency edge on file overlap", () => {
    const authPlan = makePlan("auth", [
      makeTask({ id: "T1", title: "Auth config", files_touched: ["config.ts"] }),
    ])
    const dbPlan = makePlan("db", [
      makeTask({ id: "T1", title: "DB config", files_touched: ["config.ts"] }),
    ])

    const result = mergeSubPlans([authPlan, dbPlan], "none")

    const dbDeps = result.dependency_graph["db-T1"]
    expect(dbDeps).toBeDefined()
    expect(dbDeps).toContain("auth-T1")
  })

  //#given independent tasks across plans
  //#when merging
  //#then parallelizable tasks share the same wave
  it("puts parallelizable tasks in the same wave", () => {
    const planA = makePlan("ui", [
      makeTask({ id: "T1", title: "Button", files_touched: ["button.tsx"] }),
    ])
    const planB = makePlan("api", [
      makeTask({ id: "T1", title: "Endpoint", files_touched: ["endpoint.ts"] }),
    ])

    const result = mergeSubPlans([planA, planB], "none")

    expect(result.waves).toHaveLength(1)
    expect(result.waves[0].wave).toBe(1)
    expect(result.waves[0].task_ids).toContain("ui-T1")
    expect(result.waves[0].task_ids).toContain("api-T1")
  })

  //#given merged plan
  //#when inspecting dependency_graph
  //#then all edges use namespaced IDs
  it("builds dependency graph with namespaced IDs", () => {
    const plan = makePlan("svc", [
      makeTask({ id: "A", title: "First" }),
      makeTask({ id: "B", title: "Second", depends_on: ["A"] }),
    ])

    const result = mergeSubPlans([plan], "none")

    expect(result.dependency_graph["svc-B"]).toEqual(["svc-A"])
    expect(result.dependency_graph["svc-A"]).toEqual([])
  })

  //#given merged plan
  //#when validating title/context
  //#then title and context are populated
  it("sets title and context from global constraints", () => {
    const result = mergeSubPlans([], "Must use TypeScript strict mode")

    expect(result.title).toBeTruthy()
    expect(result.context).toBeTruthy()
  })

  //#given task with duplicate files_touched
  //#when merging
  //#then task must not create self-dependency and must appear in waves
  it("task with duplicate files_touched should not create self-dependency", () => {
    // given
    const subPlans: SubPlan[] = [
      {
        domain: "auth",
        domain_description: "auth domain",
        tasks: [
          {
            id: "T1",
            title: "Task with duplicate files",
            description: "test task",
            category: "quick",
            skills: [],
            files_touched: ["file.ts", "file.ts"],
            depends_on: [],
            acceptance_criteria: ["done"],
          },
        ],
        wave_assignments: {},
        constraints_acknowledged: true,
        source_sub_planner: "sub-prometheus",
      },
    ]

    // when
    const result = mergeSubPlans(subPlans, "test constraints")

    // then — task must appear in waves (not silently dropped)
    expect(result.waves.length).toBeGreaterThan(0)
    expect(result.waves.flatMap((w) => w.task_ids)).toContain("auth-T1")
  })
})
