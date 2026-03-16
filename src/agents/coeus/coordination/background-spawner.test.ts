import { describe, test, expect } from "bun:test"
import {
  buildSubPrometheusTasks,
  enforceMaxSubPlanners,
  buildCollectionManifest,
  type SubPrometheusTask,
  type SpawnConfig,
} from "./background-spawner"

describe("buildSubPrometheusTasks", () => {
  test("creates one task per domain with constraints injected", () => {
    //#given
    const domains = ["auth", "database", "ui"]
    const constraints = "Use Bun only. No npm."
    const basePrompt = "Plan tasks for this domain."

    //#when
    const tasks = buildSubPrometheusTasks(domains, constraints, basePrompt)

    //#then
    expect(tasks).toHaveLength(3)
    expect(tasks[0].domain).toBe("auth")
    expect(tasks[1].domain).toBe("database")
    expect(tasks[2].domain).toBe("ui")
  })

  test("injects constraints into each task prompt", () => {
    //#given
    const domains = ["auth", "api"]
    const constraints = "Must use TypeScript strict mode."
    const basePrompt = "Plan for domain."

    //#when
    const tasks = buildSubPrometheusTasks(domains, constraints, basePrompt)

    //#then
    for (const task of tasks) {
      expect(task.prompt).toContain("<global-constraints>")
      expect(task.prompt).toContain("Must use TypeScript strict mode.")
    }
  })

  test("includes domain name in each task prompt", () => {
    //#given
    const domains = ["payments"]
    const constraints = ""
    const basePrompt = "Plan for domain."

    //#when
    const tasks = buildSubPrometheusTasks(domains, constraints, basePrompt)

    //#then
    expect(tasks[0].prompt).toContain("payments")
  })

  test("returns empty array for empty domains", () => {
    //#given
    const domains: string[] = []
    const constraints = "Some constraints"
    const basePrompt = "Base prompt"

    //#when
    const tasks = buildSubPrometheusTasks(domains, constraints, basePrompt)

    //#then
    expect(tasks).toHaveLength(0)
    expect(tasks).toEqual([])
  })

  test("taskId is undefined before spawn", () => {
    //#given
    const domains = ["auth"]

    //#when
    const tasks = buildSubPrometheusTasks(domains, "constraints", "prompt")

    //#then
    expect(tasks[0].taskId).toBeUndefined()
  })
})

describe("enforceMaxSubPlanners", () => {
  const makeTasks = (count: number): SubPrometheusTask[] =>
    Array.from({ length: count }, (_, i) => ({
      domain: `domain-${i}`,
      prompt: `prompt for domain-${i}`,
    }))

  test("returns all tasks when under max", () => {
    //#given
    const tasks = makeTasks(3)

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    expect(result).toHaveLength(3)
    expect(result).toEqual(tasks)
  })

  test("returns all tasks when exactly at max", () => {
    //#given
    const tasks = makeTasks(5)

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    expect(result).toHaveLength(5)
  })

  test("truncates to max when over limit", () => {
    //#given
    const tasks = makeTasks(7)

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    expect(result).toHaveLength(5)
    expect(result[0].domain).toBe("domain-0")
    expect(result[4].domain).toBe("domain-4")
  })

  test("appends truncation warning to last task prompt when truncated", () => {
    //#given
    const tasks = makeTasks(7)

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    const lastTask = result[result.length - 1]
    expect(lastTask.prompt).toContain("truncated")
    expect(lastTask.prompt).toContain("2")
  })

  test("does not modify prompts when under max", () => {
    //#given
    const tasks = makeTasks(3)
    const originalPrompts = tasks.map((t) => t.prompt)

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    result.forEach((task, i) => {
      expect(task.prompt).toBe(originalPrompts[i])
    })
  })

  test("returns empty array when max is 0", () => {
    //#given
    const tasks = makeTasks(3)

    //#when
    const result = enforceMaxSubPlanners(tasks, 0)

    //#then
    expect(result).toHaveLength(0)
  })

  test("handles empty tasks array", () => {
    //#given
    const tasks: SubPrometheusTask[] = []

    //#when
    const result = enforceMaxSubPlanners(tasks, 5)

    //#then
    expect(result).toHaveLength(0)
  })
})

describe("buildCollectionManifest", () => {
  test("returns correct domain list and count", () => {
    //#given
    const tasks: SubPrometheusTask[] = [
      { domain: "auth", prompt: "plan auth" },
      { domain: "database", prompt: "plan db" },
      { domain: "ui", prompt: "plan ui" },
    ]

    //#when
    const manifest = buildCollectionManifest(tasks)

    //#then
    expect(manifest.domains).toEqual(["auth", "database", "ui"])
    expect(manifest.expectedCount).toBe(3)
  })

  test("returns empty manifest for empty tasks", () => {
    //#given
    const tasks: SubPrometheusTask[] = []

    //#when
    const manifest = buildCollectionManifest(tasks)

    //#then
    expect(manifest.domains).toEqual([])
    expect(manifest.expectedCount).toBe(0)
  })

  test("preserves domain order", () => {
    //#given
    const tasks: SubPrometheusTask[] = [
      { domain: "zebra", prompt: "p" },
      { domain: "alpha", prompt: "p" },
      { domain: "middle", prompt: "p" },
    ]

    //#when
    const manifest = buildCollectionManifest(tasks)

    //#then
    expect(manifest.domains).toEqual(["zebra", "alpha", "middle"])
  })
})
