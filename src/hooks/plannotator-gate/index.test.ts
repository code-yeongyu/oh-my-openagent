import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createPlannotatorGateHook } from "./index"

// Mock shims
let mockWhichResult: string | null = null
let spawnCalledWith: string[][] = []

mock.module("../../shared/bun-which-shim", () => ({
  bunWhich: () => mockWhichResult,
}))

mock.module("../../shared/bun-spawn-shim", () => ({
  spawn: (cmd: string[], opts?: any) => {
    spawnCalledWith.push(cmd)
    return {
      pid: 12345,
      exitCode: null,
      exited: Promise.resolve(0),
    }
  },
}))

describe("createPlannotatorGateHook", () => {
  let tempDir: string
  let hook: ReturnType<typeof createPlannotatorGateHook>
  let callIdCounter = 0

  beforeEach(() => {
    tempDir = join(tmpdir(), `plannotator-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    hook = createPlannotatorGateHook({ directory: tempDir } as any)
    mockWhichResult = "/mock/bin/plannotator"
    spawnCalledWith = []
    callIdCounter = 0
  })

  afterEach(() => {
    mock.restore()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  test("#given non-plan file #when write executes #then does not trigger plannotator", async () => {
    callIdCounter++
    const callID = `call_${callIdCounter}`

    const inputBefore = {
      tool: "write_to_file",
      callID,
    } as any

    const outputBefore = {
      args: { TargetFile: "some_other_file.ts" },
    } as any

    await hook["tool.execute.before"]?.(inputBefore, outputBefore)

    const inputAfter = {
      tool: "write_to_file",
      callID,
    } as any

    const outputAfter = {
      output: "file written successfully",
    } as any

    await hook["tool.execute.after"]?.(inputAfter, outputAfter)

    expect(spawnCalledWith).toHaveLength(0)
    expect(outputAfter.output).not.toContain("PLANNOTATOR")
  })

  test("#given implementation_plan.md write #when plannotator not installed #then prints install suggestion", async () => {
    mockWhichResult = null
    callIdCounter++
    const callID = `call_${callIdCounter}`

    const planFile = "implementation_plan.md"
    const fullPlanPath = join(tempDir, planFile)
    writeFileSync(fullPlanPath, "some plan content")

    const inputBefore = {
      tool: "write_to_file",
      callID,
    } as any

    const outputBefore = {
      args: { TargetFile: planFile },
    } as any

    await hook["tool.execute.before"]?.(inputBefore, outputBefore)

    const inputAfter = {
      tool: "write_to_file",
      callID,
    } as any

    const outputAfter = {
      output: "written implementation_plan.md",
    } as any

    await hook["tool.execute.after"]?.(inputAfter, outputAfter)

    expect(spawnCalledWith).toHaveLength(0)
    expect(outputAfter.output).toContain("Install Plannotator CLI to unlock premium visual plan annotation")
  })

  test("#given implementation_plan.md write #when plannotator installed #then spawns plannotator and appends note", async () => {
    callIdCounter++
    const callID = `call_${callIdCounter}`

    const planFile = "implementation_plan.md"
    const fullPlanPath = join(tempDir, planFile)
    writeFileSync(fullPlanPath, "some plan content")

    const inputBefore = {
      tool: "write_to_file",
      callID,
    } as any

    const outputBefore = {
      args: { TargetFile: planFile },
    } as any

    await hook["tool.execute.before"]?.(inputBefore, outputBefore)

    const inputAfter = {
      tool: "write_to_file",
      callID,
    } as any

    const outputAfter = {
      output: "written implementation_plan.md",
    } as any

    await hook["tool.execute.after"]?.(inputAfter, outputAfter)

    expect(spawnCalledWith).toHaveLength(1)
    expect(spawnCalledWith[0]).toEqual(["plannotator", "annotate", fullPlanPath])
    expect(outputAfter.output).toContain("Opened Plannotator in your browser.")
  })
})
