import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-engine-state-dir-"))
  tempRoots.push(dir)
  return dir
}

function composeIn(cwd: string): TaskEngine {
  return composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig: loadOmoConfig({ cwd }).config,
    cwd,
    sharedParentTools: () => [],
  })
}

describe("task engine state directory", () => {
  test("#given a fresh project #when the engine persists task state #then nothing is written inside the project", () => {
    // given
    const project = tempProject()

    // when
    const engine = composeIn(project)
    const stateDir = engine.stateDir
    tempRoots.push(stateDir)
    engine.appendTaskEvent("st_0000d031", { type: "probe", payload: {} })

    // then
    expect(relative(project, stateDir).startsWith("..")).toBe(true)
    expect(existsSync(stateDir)).toBe(true)
    expect(readdirSync(project)).toEqual([])
  })

  test("#given a project that already has .omo/senpi-task #when the engine composes #then it keeps that directory", () => {
    // given
    const project = tempProject()
    mkdirSync(join(project, ".omo", "senpi-task", "tasks"), { recursive: true })
    writeFileSync(join(project, ".omo", "senpi-task", "tasks", "st_x.json"), "{}")

    // when
    const engine = composeIn(project)

    // then
    expect(engine.stateDir).toBe(join(project, ".omo", "senpi-task"))
  })

  test("#given empty .omo/senpi-task scaffolding #when the engine persists task state #then it writes outside the project", () => {
    // given
    const project = tempProject()
    mkdirSync(join(project, ".omo", "senpi-task", "tasks"), { recursive: true })

    // when
    const engine = composeIn(project)
    const stateDir = engine.stateDir
    tempRoots.push(stateDir)
    engine.appendTaskEvent("st_0000d032", { type: "probe", payload: {} })

    // then
    expect(relative(project, stateDir).startsWith("..")).toBe(true)
    expect(readdirSync(join(project, ".omo", "senpi-task"))).toEqual(["tasks"])
    expect(readdirSync(join(project, ".omo", "senpi-task", "tasks"))).toEqual([])
  })

  test("#given task.state_dir in omo.json #when the engine composes #then the configured directory wins", () => {
    // given
    const project = tempProject()
    const configured = join(tempProject(), "custom-state")
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(join(project, ".omo", "omo.json"), `${JSON.stringify({ task: { state_dir: configured } })}\n`)

    // when
    const engine = composeIn(project)

    // then
    expect(engine.stateDir).toBe(configured)
  })
})
