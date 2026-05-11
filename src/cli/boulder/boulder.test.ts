import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "bun:test"

import { boulder } from "./boulder"

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "omo-boulder-cli-"))
}

function seedPlanAndState(directory: string): void {
  const planDirectory = join(directory, ".sisyphus", "plans")
  mkdirSync(planDirectory, { recursive: true })

  const planAPath = join(planDirectory, "alpha.md")
  const planBPath = join(planDirectory, "beta.md")

  writeFileSync(
    planAPath,
    [
      "## TODOs",
      "- [x] 1. Alpha task done",
      "- [ ] 2. Alpha task running",
    ].join("\n"),
    "utf-8",
  )
  writeFileSync(
    planBPath,
    [
      "## TODOs",
      "- [x] 1. Beta task done",
      "- [x] 2. Beta task done too",
    ].join("\n"),
    "utf-8",
  )

  const boulderDirectory = join(directory, ".sisyphus")
  mkdirSync(boulderDirectory, { recursive: true })

  writeFileSync(
    join(boulderDirectory, "boulder.json"),
    JSON.stringify(
      {
        schema_version: 2,
        active_work_id: "work-alpha",
        active_plan: planAPath,
        started_at: "2026-05-10T00:00:00.000Z",
        ended_at: "2026-05-10T00:30:00.000Z",
        elapsed_ms: 1_800_000,
        status: "active",
        updated_at: "2026-05-10T00:30:00.000Z",
        session_ids: ["ses-1", "ses-2"],
        plan_name: "alpha",
        task_sessions: {
          "todo:2": {
            task_key: "todo:2",
            task_label: "2",
            task_title: "Alpha task running",
            session_id: "ses-2",
            elapsed_ms: 60000,
            status: "running",
            updated_at: "2026-05-10T00:30:00.000Z",
          },
        },
        works: {
          "work-alpha": {
            work_id: "work-alpha",
            active_plan: planAPath,
            plan_name: "alpha",
            status: "active",
            started_at: "2026-05-10T00:00:00.000Z",
            elapsed_ms: 1_800_000,
            updated_at: "2026-05-10T00:30:00.000Z",
            session_ids: ["ses-1", "ses-2"],
            task_sessions: {
              "todo:2": {
                task_key: "todo:2",
                task_label: "2",
                task_title: "Alpha task running",
                session_id: "ses-2",
                elapsed_ms: 60000,
                status: "running",
                updated_at: "2026-05-10T00:30:00.000Z",
              },
            },
          },
          "work-beta": {
            work_id: "work-beta",
            active_plan: planBPath,
            plan_name: "beta",
            status: "completed",
            started_at: "2026-05-10T01:00:00.000Z",
            ended_at: "2026-05-10T01:10:00.000Z",
            elapsed_ms: 600000,
            updated_at: "2026-05-10T01:10:00.000Z",
            session_ids: ["ses-3"],
            task_sessions: {},
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  )
}

describe("boulder command", () => {
  const createdDirectories: string[] = []
  const outputRestores: Array<() => void> = []

  afterEach(() => {
    for (const directory of createdDirectories) {
      rmSync(directory, { recursive: true, force: true })
    }
    createdDirectories.length = 0
    for (const restoreOutput of outputRestores) {
      restoreOutput()
    }
    outputRestores.length = 0
  })

  function captureOutput(target: "stdout" | "stderr", sink: { value: string }): void {
    const originalWrite = process[target].write
    process[target].write = ((chunk: string | Uint8Array) => {
      sink.value += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8")
      return true
    }) as typeof process.stdout.write

    outputRestores.push(() => {
      process[target].write = originalWrite
    })
  }

  it("prints multi-work text mode with plan names and percentages", async () => {
    const directory = createTempDirectory()
    createdDirectories.push(directory)
    seedPlanAndState(directory)

    const stdout = { value: "" }
    const stderr = { value: "" }
    captureOutput("stdout", stdout)
    captureOutput("stderr", stderr)

    const exitCode = await boulder({ directory })

    expect(exitCode).toBe(0)
    expect(stderr.value).toBe("")
    expect(stdout.value).toContain("plan: alpha")
    expect(stdout.value).toContain("plan: beta")
    expect(stdout.value).toContain("progress: 50% (1/2)")
    expect(stdout.value).toContain("progress: 100% (2/2)")
    expect(stdout.value).toContain("elapsed:")
  })

  it("prints json mode with expected fields", async () => {
    const directory = createTempDirectory()
    createdDirectories.push(directory)
    seedPlanAndState(directory)

    const stdout = { value: "" }
    captureOutput("stdout", stdout)

    const exitCode = await boulder({ directory, json: true })
    expect(exitCode).toBe(0)

    const parsed = JSON.parse(stdout.value)
    expect(parsed.works).toHaveLength(2)
    expect(parsed.works[0]).toHaveProperty("work_id")
    expect(parsed.works[0]).toHaveProperty("percentage")
    expect(parsed.works[0]).toHaveProperty("remaining_tasks")
  })

  it("returns 1 when boulder state does not exist", async () => {
    const directory = createTempDirectory()
    createdDirectories.push(directory)

    const stderr = { value: "" }
    captureOutput("stderr", stderr)

    const exitCode = await boulder({ directory })
    expect(exitCode).toBe(1)
    expect(stderr.value).toContain("No boulder state found")
  })

  it("returns 1 when workId filter matches none", async () => {
    const directory = createTempDirectory()
    createdDirectories.push(directory)
    seedPlanAndState(directory)

    const stderr = { value: "" }
    captureOutput("stderr", stderr)

    const exitCode = await boulder({ directory, workId: "missing" })
    expect(exitCode).toBe(1)
    expect(stderr.value).toContain("No boulder state found")
  })

  it("returns one work when workId filter matches", async () => {
    const directory = createTempDirectory()
    createdDirectories.push(directory)
    seedPlanAndState(directory)

    const stdout = { value: "" }
    captureOutput("stdout", stdout)

    const exitCode = await boulder({ directory, workId: "work-beta", json: true })
    expect(exitCode).toBe(0)

    const parsed = JSON.parse(stdout.value)
    expect(parsed.works).toHaveLength(1)
    expect(parsed.works[0].work_id).toBe("work-beta")
  })
})
