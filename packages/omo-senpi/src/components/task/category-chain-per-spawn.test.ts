import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle, ManagedRunner, ManagedStartSpec, RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { displayConfigPath } from "./engine-planner"
import { createTaskComponent } from "./index"
import { createTeamServiceTestModelRegistry } from "./team-service-test-model-registry"

// A long-lived session keeps one engine for its whole life and /reload is vetoed while children run, so an
// omo.json edit must reach the NEXT spawn, and a broken edit must fail that spawn rather than route it on
// another config (#11355).

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-chain-per-spawn-"))
  tempRoots.push(dir)
  return dir
}

function writeOmoJson(cwd: string, text: string): void {
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.json"), text)
}

const chain = (model: string): string => `${JSON.stringify({ categories: { quick: { model } } })}\n`
const BROKEN_LINE = '    "quick": { "model": "acme/model-a" oops }'
const BROKEN = `{\n  "categories": {\n${BROKEN_LINE}\n  }\n}\n`
const BROKEN_AT = { line: 3, column: BROKEN_LINE.indexOf("oops") + 1 }
const NOT_A_STRING = `${JSON.stringify({ categories: { quick: { model: 42 } } })}\n`


function idleHandle(spec: ManagedStartSpec): ManagedChildHandle {
  return {
    task_id: spec.taskId,
    sessionId: undefined,
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    waitForOutcome: () => new Promise<RunnerOutcome>(() => {}),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
}

function composeCapturing(cwd: string, launched: string[], overrides: NodeJS.ProcessEnv = {}): TaskEngine {
  const env = { ...process.env, ...overrides }
  const capture: ManagedRunner = {
    start: (spec) => {
      launched.push(String(spec.model))
      return Promise.resolve(idleHandle(spec))
    },
  }
  const engine = composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig: loadSenpiOmoConfig({ cwd, env }).config,
    loadOmoConfig: () => loadSenpiOmoConfig({ cwd, env }),
    cwd,
    sharedParentTools: () => [],
    runnerFactories: { inProcess: () => capture, process: () => capture },
  })
  engine.runtime.captureFrom({
    sessionManager: { getSessionId: () => "session-1" },
    modelRegistry: createTeamServiceTestModelRegistry(["acme/model-a", "acme-b/model-b"]),
  })
  return engine
}

const spawnQuick = (engine: TaskEngine) =>
  engine.manager.start({
    prompt: "do the thing",
    parent_session_id: "session-1",
    depth: 0,
    category: "quick",
    execution_mode: "in-process",
    run_in_background: true,
  })

describe("task engine omo config per spawn (#11355)", () => {
  test("#given omo.json broken, then invalid, then fixed between spawns #when each child is planned #then a broken or invalid layer fails the spawn with its file and position, never the startup chain, and the fixed file routes the next spawn", async () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, chain("acme/model-a"))
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched)
    expect((await spawnQuick(engine)).kind).toBe("started")

    // when the file is half-edited
    writeOmoJson(cwd, BROKEN)
    const broken = await spawnQuick(engine)

    // then
    if (broken.kind !== "plan_unresolved") throw new Error(`expected a config error, got ${broken.kind}`)
    expect(broken.error.code).toBe("config_invalid")
    expect(broken.error.config_error).toMatchObject({ kind: "parse", position: BROKEN_AT })
    const parseError = broken.error.config_error
    if (parseError?.kind !== "parse") throw new Error(`expected a parse error, got ${parseError?.kind}`)
    expect(parseError.path.endsWith(join(".omo", "omo.json"))).toBe(true)
    expect(broken.error.message).toContain(`${join(".omo", "omo.json")}:${BROKEN_AT.line}:${BROKEN_AT.column}`)

    // when a value has the wrong type
    writeOmoJson(cwd, NOT_A_STRING)
    const invalid = await spawnQuick(engine)

    // then
    if (invalid.kind !== "plan_unresolved") throw new Error(`expected a config error, got ${invalid.kind}`)
    expect(invalid.error.code).toBe("config_invalid")
    expect(invalid.error.config_error).toMatchObject({ kind: "validation", issue_paths: ["categories.quick.model"] })
    expect(invalid.error.message).toContain("at categories.quick.model")

    // when the file is fixed with a new chain
    writeOmoJson(cwd, chain("acme-b/model-b"))
    const fixed = await spawnQuick(engine)

    // then only the valid configs launched children: never the startup chain for the broken or invalid file
    expect(fixed.kind).toBe("started")
    expect(launched).toEqual(["acme/model-a", "acme-b/model-b"])
  })
})

// Every routing field gets a wrong type (a string where an array belongs and the reverse), null, and a model id that
// is neither "provider/model" nor a catalog name, always NEXT TO valid keys: the loader keeps such a layer by dropping
// the bad leaf, so only the routing check stops the spawn from running on another layer or the defaults.
const VALID = { quick: { model: "acme/model-a" }, writing: { model: "acme-b/model-b" } }
const ROUTING_ROWS: readonly (readonly [label: string, config: Record<string, unknown>, issuePath: string])[] = [
  ["category model is a number", { categories: { ...VALID, quick: { model: 42 } } }, "categories.quick.model"],
  ["category model is null", { categories: { ...VALID, quick: { model: null } } }, "categories.quick.model"],
  ["category model is an array", { categories: { ...VALID, quick: { model: ["acme/model-a"] } } }, "categories.quick.model"],
  ["category model has no provider", { categories: { ...VALID, quick: { model: "model-a" } } }, "categories.quick.model"],
  ["category models is a string", { categories: { ...VALID, quick: { models: "acme/model-a" } } }, "categories.quick.models"],
  ["category models holds a number", { categories: { ...VALID, quick: { models: [42] } } }, "categories.quick.models"],
  ["category models holds a model id with no provider", { categories: { ...VALID, quick: { models: ["model-a"] } } }, "categories.quick.models.0"],
  ["category fallback_models is a number", { categories: { ...VALID, quick: { model: "acme/model-a", fallback_models: 7 } } }, "categories.quick.fallback_models"],
  ["category fallback_models is null", { categories: { ...VALID, quick: { model: "acme/model-a", fallback_models: null } } }, "categories.quick.fallback_models"],
  ["category fallback entry has a numeric model", { categories: { ...VALID, quick: { model: "acme/model-a", fallback_models: [{ model: 5 }] } } }, "categories.quick.fallback_models"],
  ["category variant is an array", { categories: { ...VALID, quick: { model: "acme/model-a", variant: ["high"] } } }, "categories.quick.variant"],
  ["category entry is a string", { categories: { ...VALID, quick: "acme/model-a" } }, "categories.quick"],
  ["agent model is a number", { categories: VALID, agents: { scout: { model: 3 } } }, "agents.scout.model"],
  ["agent model is null", { categories: VALID, agents: { scout: { model: null } } }, "agents.scout.model"],
  ["agent model has no provider", { categories: VALID, agents: { scout: { model: "scout-model" } } }, "agents.scout.model"],
  ["agent models is a string", { categories: VALID, agents: { scout: { models: "acme/model-a" } } }, "agents.scout.models"],
  ["exclude_models is a string", { categories: VALID, exclude_models: "acme/model-b" }, "exclude_models"],
  ["exclude_models holds a number", { categories: VALID, exclude_models: [42] }, "exclude_models"],
]

describe("task engine routing fields are checked at every spawn (#11355)", () => {
  test.each(ROUTING_ROWS)("#given %s next to valid keys #when a child is planned #then the spawn fails at that field and no child launches", async (_label, config, issuePath) => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, `${JSON.stringify(config)}\n`)
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched)

    // when
    const result = await spawnQuick(engine)

    // then
    if (result.kind !== "plan_unresolved") throw new Error(`expected a config error at ${issuePath}, got ${result.kind}`)
    expect(result.error.code).toBe("config_invalid")
    expect(result.error.config_error?.issue_paths?.some((path) => path === issuePath || path.startsWith(`${issuePath}.`))).toBe(true)
    expect(result.error.message).toContain(issuePath)
    expect(launched).toEqual([])
  })

  test("#given an invalid field that does not route (task.default_concurrency) next to valid keys #when a child is planned #then it spawns on the configured model as before", async () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, `${JSON.stringify({ task: { default_concurrency: "x" }, categories: VALID })}\n`)
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched)

    // when
    const result = await spawnQuick(engine)

    // then
    expect(result.kind).toBe("started")
    expect(launched).toEqual(["acme/model-a"])
  })
})

const BASE = { categories: { quick: { model: "acme/model-a" } } }

// Every routing location, in the project layer and in the user layer: [path to the entry object, field].
const LOCATIONS: readonly (readonly [label: string, path: readonly string[], field: "model" | "models" | "exclude_models"])[] = [
  ["base category", ["categories", "writing"], "model"],
  ["base category chain", ["categories", "writing"], "models"],
  ["base agent", ["agents", "scout"], "model"],
  ["base exclude_models", [], "exclude_models"],
  ["[native] category", ["[native]", "categories", "writing"], "model"],
  ["[senpi] agent", ["[senpi]", "agents", "scout"], "model"],
  ["active profile category", ["profiles", "p", "categories", "writing"], "model"],
  ["active profile [native] agent", ["profiles", "p", "[native]", "agents", "scout"], "model"],
  ["inactive profile category", ["profiles", "q", "categories", "writing"], "model"],
  ["inactive profile [native] category chain", ["profiles", "q", "[native]", "categories", "writing"], "models"],
]
const VALUES: Readonly<Record<"model" | "models" | "exclude_models", readonly (readonly [kind: string, value: unknown])[]>> = {
  model: [["wrong type", 42], ["unknown model shape", "model-a"], ["null", null], ["empty", ""]],
  models: [["wrong type", "acme/model-a"], ["unknown model shape", ["model-a"]], ["null", null], ["empty", []]],
  exclude_models: [["wrong type", "acme/model-b"], ["unknown model shape", [7]], ["null", null], ["empty", [""]]],
}

function withValue(path: readonly string[], field: string, value: unknown): Record<string, unknown> {
  const config: Record<string, unknown> = structuredClone(BASE)
  let node = config
  for (const key of path) {
    const next = node[key]
    node[key] = typeof next === "object" && next !== null ? next : {}
    node = node[key] as Record<string, unknown>
  }
  node[field] = value
  return config
}

const MATRIX = (["project", "user"] as const).flatMap((layer) =>
  LOCATIONS.flatMap(([label, path, field]) =>
    VALUES[field].map(([kind, value]) => ({
      name: `${kind} at the ${label} in the ${layer} layer`,
      layer,
      config: withValue(path, field, value),
      issuePath: [...path, field].join("."),
      // The loader folds the legacy [senpi] block into [native] (with its own deprecation warning), so either spelling names the field.
      issuePaths: [[...path, field].join("."), [...path, field].join(".").replace("[senpi]", "[native]")],
    })),
  ),
)

function writeUserOmoJson(home: string, config: Record<string, unknown>): void {
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), `${JSON.stringify(config)}\n`)
}

// Configs that must keep spawning: the legacy reasoning suffixes the loader still reads, catalog names a Senpi scope
// defines, another harness's block, and a requested profile that does not exist (the loader keeps the base config).
const STILL_SPAWNS: readonly (readonly [label: string, config: Record<string, unknown>, launched: string])[] = [
  ["the legacy 'model (high)' suffix", { categories: { quick: { model: "acme/model-a (high)" } } }, "acme/model-a"],
  ["the legacy 'model high' suffix", { categories: { quick: { model: "acme/model-a high" } } }, "acme/model-a"],
  ["a catalog name defined in [native]", { "[native]": { models: { fast: { model: "acme-b/model-b" } } }, categories: { quick: { model: "fast" } } }, "acme-b/model-b"],
  ["a catalog name defined in the active profile", { profiles: { p: { models: { fast: { model: "acme-b/model-b" } }, categories: { quick: { model: "fast" } } } } }, "acme-b/model-b"],
  ["a bad field in the [codex] block", { ...BASE, "[codex]": { agents: { explorer: { model: 5 } } } }, "acme/model-a"],
]

describe("task engine routing locations (#11355)", () => {
  test.each(MATRIX.map((row) => [row.name, row] as const))("#given %s next to valid keys #when a child is planned with profile p active #then the spawn fails at that field and no child launches", async (_name, row) => {
    // given
    const cwd = tempProject()
    const home = tempProject()
    if (row.layer === "user") {
      writeUserOmoJson(home, row.config)
      writeOmoJson(cwd, `${JSON.stringify(BASE)}\n`)
    } else {
      writeOmoJson(cwd, `${JSON.stringify(row.config)}\n`)
    }
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched, { HOME: home, OMO_PROFILE: "p" })

    // when
    const result = await spawnQuick(engine)

    // then
    if (result.kind !== "plan_unresolved") throw new Error(`expected a config error at ${row.issuePath}, got ${result.kind} on ${launched.join(",")}`)
    expect(result.error.code).toBe("config_invalid")
    expect(row.issuePaths.some((path) => result.error.message.includes(path))).toBe(true)
    expect(launched).toEqual([])
  })

  test.each(STILL_SPAWNS)("#given %s #when a child is planned with profile p active #then it spawns on the model it names", async (_label, config, model) => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, `${JSON.stringify(config)}\n`)
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched, { HOME: tempProject(), OMO_PROFILE: "p" })

    // when
    const result = await spawnQuick(engine)

    // then
    if (result.kind !== "started") throw new Error(`expected a spawn, got ${result.kind}: ${result.kind === "plan_unresolved" ? result.error.message : ""}`)
    expect(launched).toEqual([model])
  })

  test("#given a requested profile that does not exist #when a child is planned #then it spawns on the base config as before", async () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, `${JSON.stringify(BASE)}\n`)
    const launched: string[] = []
    const engine = composeCapturing(cwd, launched, { HOME: tempProject(), OMO_PROFILE: "missing" })

    // when
    const result = await spawnQuick(engine)

    // then
    expect(result.kind).toBe("started")
    expect(launched).toEqual(["acme/model-a"])
  })
})

describe("task component omo config wiring (#11355)", () => {
  function ctxFor(pi: FakeExtensionAPI): ComponentContext {
    return {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      config: { getFlag: (name) => pi.getFlag(name) },
      getCapturedTools: () => [],
    }
  }

  test("#given the registered task tool #when it spawns twice against a broken omo.json #then each spawn loads omo config exactly once and fails naming the file and position", async () => {
    // given
    const cwd = tempProject()
    writeOmoJson(cwd, chain("acme/model-a"))
    const pi = new FakeExtensionAPI()
    pi.cwd = cwd
    let loads = 0
    await createTaskComponent({
      resolveCwd: () => cwd,
      loadConfig: (options = {}) => {
        loads += 1
        return loadSenpiOmoConfig(options)
      },
    }).register(pi, ctxFor(pi))
    const tool = pi.tools.find((candidate) => candidate.name === "task") as
      | { execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; details: { status: string } }> }
      | undefined
    if (tool === undefined) throw new Error("task tool not registered")
    writeOmoJson(cwd, BROKEN)
    const spawn = () =>
      tool.execute(
        "call-1",
        { prompt: "do the thing", category: "quick", run_in_background: true, load_skills: [] },
        undefined,
        undefined,
        { cwd, sessionManager: { getSessionId: () => "session-1" } },
      )

    // when
    const before = loads
    const first = await spawn()
    const afterFirst = loads
    const second = await spawn()

    // then
    expect(afterFirst - before).toBe(1)
    expect(loads - afterFirst).toBe(1)
    for (const result of [first, second]) {
      expect(result.details.status).toBe("plan_error")
      expect(result.content.map((part) => part.text).join("")).toContain(`${join(".omo", "omo.json")}:${BROKEN_AT.line}:${BROKEN_AT.column}`)
    }
  })
})

describe("omo config error path display (#11355)", () => {
  test.each([
    ["a POSIX home", "/home/dev", "/home/dev/project/.omo/omo.json", "~/project/.omo/omo.json"],
    ["a Windows home", "C:\\Users\\dev", "C:\\Users\\dev\\project\\.omo\\omo.json", "~\\project\\.omo\\omo.json"],
    ["a path outside the home", "/home/dev", "/srv/project/.omo/omo.json", "/srv/project/.omo/omo.json"],
    ["a sibling that only shares the prefix", "/home/dev", "/home/devops/.omo/omo.json", "/home/devops/.omo/omo.json"],
  ])("#given %s #when the error names the file #then the home directory is never shown", (_label, home, path, shown) => {
    expect(displayConfigPath(path, home)).toBe(shown)
  })
})
