import { afterEach, describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { resolveCategory } from "../category"
import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { createMinimalSenpiResourceLoader } from "../senpi/minimal-resource-loader"
import { asSenpiThinkingLevel } from "../senpi/thinking-level"
import { assistant, streamMessage } from "./__fixtures__/in-process-fallback-session"
import { createRuntimeFallbackSettings } from "./in-process/runtime-fallback-settings"

// #9378. Only the logged-in providers are faked (an api-key auth.json in a temp agent dir); the model
// catalog, the thinking-level validation and the fallback walk are the real engine's.

type Barrel = Awaited<ReturnType<typeof loadSenpiBarrel>>
type Registry = InstanceType<Barrel["ModelRegistry"]>
type Session = Awaited<ReturnType<Barrel["createAgentSession"]>>["session"]
type CatalogModel = NonNullable<ReturnType<Registry["find"]>>

type Machine = {
  readonly senpi: Barrel
  readonly root: string
  readonly agentDir: string
  readonly modelRuntime: Registry["modelRuntime"]
  readonly modelRegistry: Registry
}

const roots: string[] = []
const sessions: Session[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function machineLoggedInTo(providers: readonly string[]): Promise<Machine> {
  const senpi = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-9378-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  const authPath = join(agentDir, "auth.json")
  writeFileSync(authPath, JSON.stringify(Object.fromEntries(providers.map((provider) => [provider, { type: "api_key", key: "test-key" }]))))
  const modelRuntime = await senpi.ModelRuntime.create({ agentDir, authPath, allowModelNetwork: false })
  return { senpi, root, agentDir, modelRuntime, modelRegistry: new senpi.ModelRegistry(modelRuntime) }
}

async function startCategoryChild(machine: Machine, category: string, config: OmoConfig = {}): Promise<Session> {
  const resolution = resolveCategory<CatalogModel>(category, config, machine.modelRegistry)
  if (resolution.kind !== "resolved") throw new Error(`${category} did not resolve: ${resolution.kind}`)
  const { spec } = resolution
  const thinkingLevel = asSenpiThinkingLevel(spec.reasoning ?? spec.variant)
  const { session } = await machine.senpi.createAgentSession({
    cwd: machine.root,
    agentDir: machine.agentDir,
    model: spec.model,
    modelRuntime: machine.modelRuntime,
    modelRegistry: machine.modelRegistry,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    settingsManager: createRuntimeFallbackSettings(
      { cwd: machine.root, agentDir: machine.agentDir, projectTrusted: false },
      `${spec.provider}/${spec.modelId}`,
      spec.fallback_models,
    ),
    sessionManager: machine.senpi.SessionManager.inMemory(),
    resourceLoader: createMinimalSenpiResourceLoader({ runtime: machine.senpi.createExtensionRuntime() }),
    tools: [],
    customTools: [],
    scopedModels: [],
    favoriteModels: [],
  })
  sessions.push(session)
  return session
}

type FallbackLogLine = { readonly event: string; readonly warning?: string; readonly candidate?: string; readonly skipReason?: string }

function fallbackLog(machine: Machine): readonly FallbackLogLine[] {
  const path = join(machine.agentDir, "logs", "fallback.log")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as FallbackLogLine)
}

function validationWarnings(machine: Machine): readonly string[] {
  return fallbackLog(machine).flatMap((line) => line.event === "validation_warning" && line.warning !== undefined ? [line.warning] : [])
}

describe("builtin category chains run at a thinking level the model accepts (#9378)", () => {
  test.each([
    { machine: ["opencode-go"], category: "quick", model: "opencode-go/minimax-m3", effort: "low", why: "the quick lane's own level" },
    { machine: ["xiaomi"], category: "unspecified-low", model: "xiaomi/mimo-v2.6-pro", effort: "high", why: "the level it already ran at" },
    { machine: ["alibaba-token-plan"], category: "unspecified-low", model: "alibaba-token-plan/qwen3.8-max-preview", effort: "high", why: "the level it already ran at" },
  ])("#given only $machine is logged in #when $category starts a child #then it runs $model at $effort, $why", async ({ machine: providers, category, model, effort }) => {
    // given: every rung ahead of the expected one is served by a provider this machine lacks
    const machine = await machineLoggedInTo(providers)

    // when
    const session = await startCategoryChild(machine, category)

    // then: the session starts on that model at the effort the lane asks for, which the model accepts, not a silent clamp
    expect(`${session.model?.provider}/${session.model?.id}`).toBe(model)
    expect(session.thinkingLevel).toBe(effort)
    expect(session.getAvailableThinkingLevels()).toContain(session.thinkingLevel)
  }, 20_000)

  test("#given a machine on opencode-go and xiaomi #when children of every category it serves start, as each config reload does #then fallback.log records no unsupported-thinking-level warning for the builtin chains", async () => {
    // given: both providers that serve the rungs that carried an unsupported level
    const machine = await machineLoggedInTo(["opencode-go", "xiaomi"])

    // when: two loads per category, the way a live session revalidates on every reload
    const started: Session[] = []
    for (const category of ["quick", "unspecified-low", "unspecified-high", "visual-engineering", "artistry"]) {
      started.push(await startCategoryChild(machine, category))
      started.push(await startCategoryChild(machine, category))
    }

    // then
    expect(started.flatMap((session) => session.fallbackValidationWarnings)).toEqual([])
    expect(validationWarnings(machine)).toEqual([])
  }, 30_000)

  test("#given a user category whose models list sets a level that model rejects #when the child starts and its primary fails #then that entry warns once naming the level and the model, and still runs at a level the model accepts", async () => {
    // given: a user lane on a provider whose middle model reasons but takes no discrete max level
    const machine = await machineLoggedInTo([])
    const calls: string[] = []
    const testModel = (id: string, reasoning: boolean) => ({
      id,
      name: id,
      reasoning,
      input: ["text"] as Array<"text">,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    })
    Reflect.apply(machine.modelRegistry.registerProvider, machine.modelRegistry, ["runtime-fallback-test", {
      api: "openai-completions",
      baseUrl: "file://runtime-fallback-test",
      apiKey: "test-key",
      models: [testModel("dead-primary", false), testModel("no-max-reasoner", true), testModel("healthy-fallback", false)],
      streamSimple(model: { readonly id: string }) {
        calls.push(model.id)
        return streamMessage(model.id === "dead-primary"
          ? assistant(model.id, "error", "", "429: rate limit exceeded, retry later")
          : assistant(model.id, "stop", "fallback completed"))
      },
    }])
    const config: OmoConfig = {
      categories: {
        "user-lane": {
          description: "user lane",
          models: [
            "runtime-fallback-test/dead-primary",
            { model: "runtime-fallback-test/no-max-reasoner", variant: "max" },
            "runtime-fallback-test/healthy-fallback",
          ],
        },
      },
    }

    // when
    const session = await startCategoryChild(machine, "user-lane", config)
    await session.prompt("finish through the user's fallback")

    // then: one warning naming the level and the model; omo keeps the user's entry and the engine runs it at a level it accepts
    expect(validationWarnings(machine)).toEqual([
      'Fallback chain entry "runtime-fallback-test/no-max-reasoner:max" uses thinking level "max", which is unsupported by runtime-fallback-test/no-max-reasoner.',
    ])
    expect(calls).toEqual(["dead-primary", "no-max-reasoner"])
    expect(session.model?.id).toBe("no-max-reasoner")
    expect(session.thinkingLevel).not.toBe("max")
    expect(session.getAvailableThinkingLevels()).toContain(session.thinkingLevel)
    expect(session.getLastAssistantText()).toBe("fallback completed")
  }, 20_000)
})
