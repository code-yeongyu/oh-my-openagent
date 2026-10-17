import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createTaskComponent } from "./index"
import { wireSessionStartProcessSweep } from "./process-sweep"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-role-gating-"))
  tempRoots.push(dir)
  return dir
}

function logger(): ComponentLogger & { readonly entries: string[] } {
  const entries: string[] = []
  return {
    entries,
    info: (message) => entries.push(message),
    warn: (message) => entries.push(message),
    error: (message) => entries.push(message),
  }
}

function ctxFor(pi: FakeExtensionAPI, log: ComponentLogger): ComponentContext {
  return { logger: log, config: { getFlag: (name) => pi.getFlag(name) }, getCapturedTools: () => [] }
}

function piForRole(role: string | undefined): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  if (role !== undefined) {
    Object.defineProperty(pi, "sessionContext", { value: { role, task_id: "st_00000001", state_dir: "/tmp/dh-state" } })
  }
  return pi
}

function toolNames(pi: FakeExtensionAPI): readonly string[] {
  return pi.tools.map((tool) => tool["name"]).filter((name): name is string => typeof name === "string")
}

describe("task component session-role gating", () => {
  test("#given a parent session #when the component registers #then the task tool family is available", async () => {
    // given
    const pi = piForRole(undefined)

    // when
    await createTaskComponent({ resolveCwd: tempProject }).register(pi, ctxFor(pi, logger()))

    // then
    expect(toolNames(pi)).toContain("task")
    expect(toolNames(pi)).toContain("task_output")
  })

  test("#given a plain child session on the shared daemon #when the component registers #then it keeps the task tool family", async () => {
    // given
    const pi = piForRole("child")

    // when
    await createTaskComponent({ resolveCwd: tempProject }).register(pi, ctxFor(pi, logger()))

    // then
    expect(toolNames(pi)).toContain("task")
  })

  test("#given a dag child session #when the component registers #then no task tool is registered", async () => {
    // given
    const pi = piForRole("dag_child")

    // when
    await createTaskComponent({ resolveCwd: tempProject }).register(pi, ctxFor(pi, logger()))

    // then
    expect(toolNames(pi)).toEqual([])
  })

  test("#given a team member session #when the component registers #then the lead-only task engine stays out of it", async () => {
    // given
    const pi = piForRole("member")

    // when
    await createTaskComponent({ resolveCwd: tempProject }).register(pi, ctxFor(pi, logger()))

    // then
    expect(toolNames(pi)).toEqual([])
  })
})

describe("process sweep session-role gating", () => {
  test("#given a child session on a daemon with no child env #when the session starts #then the sweep is skipped", async () => {
    // given
    const pi = piForRole("child")
    let sweeps = 0
    wireSessionStartProcessSweep(pi, ctxFor(pi, logger()), {
      env: {},
      sweep: () => {
        sweeps += 1
        return Promise.resolve()
      },
    })

    // when
    await pi.dispatch("session_start", {}, {})

    // then
    expect(sweeps).toBe(0)
  })

  test("#given a parent session #when the session starts #then the sweep runs", async () => {
    // given
    const pi = piForRole(undefined)
    let sweeps = 0
    wireSessionStartProcessSweep(pi, ctxFor(pi, logger()), {
      env: {},
      sweep: () => {
        sweeps += 1
        return Promise.resolve()
      },
    })

    // when
    await pi.dispatch("session_start", {}, {})

    // then
    expect(sweeps).toBe(1)
  })
})
