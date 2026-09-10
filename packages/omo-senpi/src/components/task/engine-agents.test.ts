import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { BUILTIN_AGENTS, buildTaskToolDescription } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-engine-agents-"))
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

function writeOmoJson(cwd: string, config: unknown): void {
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify(config)}\n`)
}

// The rendered "Available agents: a, b, c" fragment of the task tool description. The example line
// quoting subagent_type="momus" must never leak into this extraction, so the marker anchors it.
function advertisedAgentNames(engine: TaskEngine): string {
  const description = buildTaskToolDescription({ omoConfig: engine.omoConfig, agents: engine.agents })
  const marker = "Available agents: "
  const start = description.indexOf(marker)
  if (start < 0) throw new Error("task tool description is missing the Available agents list")
  const rest = description.slice(start + marker.length)
  const end = rest.indexOf("\n")
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

function advertisedPlanGatedAgentNames(engine: TaskEngine): string {
  const description = buildTaskToolDescription({ omoConfig: engine.omoConfig, agents: engine.agents })
  const marker =
    "Plan-gated agents (spawnable only after the user explicitly requests the ulw-plan workflow, a .omo/plans/*.md plan artifact was touched in this session, and ulw-execute was never invoked): "
  const start = description.indexOf(marker)
  if (start < 0) throw new Error("task tool description is missing the Plan-gated agents list")
  const rest = description.slice(start + marker.length)
  const end = rest.indexOf("\n")
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

describe("task engine builtin agent overlay", () => {
  test("#given no omo.json agents #when the engine resolves agents #then the builtin curated agents are present", () => {
    // given / when
    const engine = composeIn(tempProject())

    // then
    expect(Object.keys(engine.agents).sort()).toEqual([
      "explore",
      "librarian",
      "metis",
      "momus",
      "omo-senpi-code-reviewer",
      "omo-senpi-gate-reviewer",
      "omo-senpi-qa-executor",
    ])
    expect(engine.agents["explore"]?.executionMode).toBe("in-process")
    expect(engine.agents["omo-senpi-code-reviewer"]?.executionMode).toBe("in-process")
  })

  test("#given an omo.json model override for a builtin agent #when the engine resolves agents #then the model wins and the builtin prompt and allowlist survive", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, { agents: { explore: { model: "acme/custom-1" } } })

    // when
    const engine = composeIn(cwd)

    // then
    const explore = engine.agents["explore"]
    expect(explore?.model).toBe("acme/custom-1")
    expect(explore?.prompt).toBe(BUILTIN_AGENTS["explore"]?.prompt)
    expect(explore?.tools?.length).toBe(BUILTIN_AGENTS["explore"]?.tools?.length)
    expect(explore?.tools).toContainEqual({ pattern: "x_search", allow: false })
  })

  test("#given an omo.json-only agent #when the engine resolves agents #then it is appended alongside the builtins", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, { agents: { scout: { description: "Project scout", prompt: "Scout the repo." } } })

    // when
    const engine = composeIn(cwd)

    // then
    expect(Object.keys(engine.agents).sort()).toEqual([
      "explore",
      "librarian",
      "metis",
      "momus",
      "omo-senpi-code-reviewer",
      "omo-senpi-gate-reviewer",
      "omo-senpi-qa-executor",
      "scout",
    ])
    expect(engine.agents["scout"]?.prompt).toBe("Scout the repo.")
  })

  test("#given a process override for a curated agent #when the engine resolves agents #then in-process execution remains pinned", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, { agents: { explore: { execution_mode: "process" } } })

    // when
    const engine = composeIn(cwd)

    // then
    expect(engine.agents["explore"]?.executionMode).toBe("in-process")
  })

  test("#given a process override for a reviewer agent #when the engine resolves agents #then in-process execution remains pinned", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, { agents: { "omo-senpi-code-reviewer": { execution_mode: "process" } } })

    // when
    const engine = composeIn(cwd)

    // then
    expect(engine.agents["omo-senpi-code-reviewer"]?.executionMode).toBe("in-process")
    expect(engine.agents["omo-senpi-qa-executor"]?.executionMode).toBe("in-process")
    expect(engine.agents["omo-senpi-gate-reviewer"]?.executionMode).toBe("in-process")
  })

  test("#given a process-mode user agent #when the engine resolves agents #then its execution mode remains configurable", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, {
      agents: { scout: { description: "Project scout", execution_mode: "process" } },
    })

    // when
    const engine = composeIn(cwd)

    // then
    expect(engine.agents["scout"]?.executionMode).toBe("process")
  })

  test("#given the default engine agents #when the task tool description renders #then plain builtins are advertised and the plan-gated tier is classified separately", () => {
    // given
    const engine = composeIn(tempProject())

    // when / then
    expect(advertisedAgentNames(engine)).toBe(
      "explore, librarian, omo-senpi-code-reviewer, omo-senpi-gate-reviewer, omo-senpi-qa-executor",
    )
    expect(advertisedPlanGatedAgentNames(engine)).toBe("metis, momus")
  })

  test("#given agents.momus.disable in omo.json #when the description renders #then momus is hidden and the other three stay listed", () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, { agents: { momus: { disable: true } } })

    // when
    const engine = composeIn(cwd)

    // then
    expect(engine.agents["momus"]?.disable).toBe(true)
    expect(advertisedAgentNames(engine)).toBe(
      "explore, librarian, omo-senpi-code-reviewer, omo-senpi-gate-reviewer, omo-senpi-qa-executor",
    )
    expect(advertisedPlanGatedAgentNames(engine)).toBe("metis")
  })
})
