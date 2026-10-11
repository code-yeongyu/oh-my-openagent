import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig, omoConfigDiagnosticLines } from "../index"

const MERGED_CONFIG_DIAGNOSTIC_PATH = "(merged omo config)"

type Fixture = { readonly cwd: string; readonly homeDir: string; readonly root: string }

const roots: string[] = []

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-config-prune-paths-"))
  roots.push(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, root }
}

function writeUserConfig(fixture: Fixture, document: unknown): string {
  const path = join(fixture.homeDir, ".omo", "omo.jsonc")
  mkdirSync(join(fixture.homeDir, ".omo"), { recursive: true })
  writeFileSync(path, typeof document === "string" ? document : JSON.stringify(document))
  return path
}

function writeProjectConfig(fixture: Fixture, document: unknown): string {
  const path = join(fixture.cwd, ".omo", "omo.jsonc")
  mkdirSync(join(fixture.cwd, ".omo"), { recursive: true })
  writeFileSync(path, typeof document === "string" ? document : JSON.stringify(document))
  return path
}

function load(fixture: Fixture, options: { readonly harness?: "senpi"; readonly profile?: string } = {}) {
  return loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir }, platform: "linux", ...options })
}

function droppedKeys(result: ReturnType<typeof load>): readonly (string | undefined)[] {
  return result.diagnostics.filter((d) => d.kind === "invalid-value").map((d) => d.issuePaths?.[0])
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("loadOmoConfig prunes only the invalid path in every section", () => {
  test("#given task.host_engine_policy is invalid beside a valid task.default_concurrency #when loading #then only host_engine_policy is dropped and default_concurrency applies", () => {
    // given
    const fixture = makeFixture()
    const path = writeUserConfig(fixture, {
      task: { host_engine_policy: "sometimes", default_concurrency: 3 },
      agents: { sisyphus: { model: "anthropic/claude-opus-5" } },
    })

    // when
    const result = load(fixture)

    // then
    expect(result.config.task?.default_concurrency).toBe(3)
    expect(result.config.task?.host_engine_policy).toBe("upgrade")
    expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
    expect(result.sources.find((source) => source.path === path)?.loaded).toBe(true)
    expect(result.diagnostics).toEqual([expect.objectContaining({ kind: "invalid-value", path, issuePaths: ["task.host_engine_policy"] })])
  })

  test("#given one invalid field inside agents.oracle #when loading #then only that field is dropped and the agent's other fields survive", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, { agents: { oracle: { model: "openai/gpt-6", temperature: "hot", max_turns: 7 } } })

    // when
    const result = load(fixture)

    // then
    expect(result.config.agents?.oracle).toMatchObject({ model: "openai/gpt-6", max_turns: 7 })
    expect(result.config.agents?.oracle?.temperature).toBeUndefined()
    expect(droppedKeys(result)).toEqual(["agents.oracle.temperature"])
  })

  test("#given canonical max_tokens beside an invalid legacy maxTokens value #when loading #then keeps the category and reports the invalid legacy leaf", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, {
      categories: { quick: { model: "provider/quick", max_tokens: 4096, maxTokens: "bad" } },
    })

    // when
    const result = load(fixture)

    // then
    expect(result.config.categories?.quick?.model).toBe("provider/quick")
    expect(result.config.categories?.quick?.max_tokens).toBe(4096)
    expect(droppedKeys(result)).toEqual(["categories.quick.maxTokens"])
  })

  test("#given an invalid field inside an array element (teams.alpha.members[0].color) #when loading #then only that field is dropped and the element survives", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, {
      teams: {
        alpha: {
          members: [{ kind: "category", name: "worker", category: "quick", prompt: "go", color: 5 }],
        },
      },
    })

    // when
    const result = load(fixture)

    // then
    const member = result.config.teams?.alpha?.members[0]
    expect(member).toMatchObject({ kind: "category", name: "worker", category: "quick", prompt: "go" })
    expect(member?.color).toBeUndefined()
    expect(droppedKeys(result)).toEqual(["teams.alpha.members.0.color"])
  })

  test("#given an unknown key inside an array element (teams.alpha.members[0].bogus) #when loading #then only that key is dropped and reported as an unknown key", () => {
    // given
    const fixture = makeFixture()
    const path = writeUserConfig(fixture, {
      teams: {
        alpha: {
          members: [{ kind: "category", name: "worker", category: "quick", prompt: "go", bogus: true }],
        },
      },
    })

    // when
    const result = load(fixture)

    // then
    const member = result.config.teams?.alpha?.members[0]
    expect(member).toMatchObject({ kind: "category", name: "worker", category: "quick", prompt: "go" })
    expect(member).not.toHaveProperty("bogus")
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "unknown-keys", path, issuePaths: ["teams.alpha.members.0.bogus"] }),
    ])
    expect(omoConfigDiagnosticLines(result.diagnostics, { homeDir: fixture.homeDir })).toEqual([
      "config: ~/.omo/omo.jsonc: teams.alpha.members.0.bogus ignored (unknown key)",
    ])
  })

  test("#given unknown keys at the root and inside an array element #when loading #then one unknown-keys diagnostic lists both dotted keys and none has an empty key list", () => {
    // given
    const fixture = makeFixture()
    const path = writeUserConfig(fixture, {
      bogus_top: 1,
      teams: { alpha: { members: [{ kind: "category", name: "worker", category: "quick", prompt: "go", extra: "x" }] } },
    })

    // when
    const result = load(fixture)

    // then
    const unknown = result.diagnostics.filter((d) => d.kind === "unknown-keys")
    expect(unknown).toHaveLength(1)
    expect(unknown[0]?.path).toBe(path)
    expect([...(unknown[0]?.issuePaths ?? [])].sort()).toEqual(["bogus_top", "teams.alpha.members.0.extra"])
    expect(unknown.every((d) => (d.issuePaths?.length ?? 0) > 0 && !d.message.endsWith(": "))).toBe(true)
    expect(result.diagnostics.some((d) => d.kind === "invalid-value")).toBe(false)
  })

  test("#given invalid values in a harness block and a profile beside valid siblings #when loading the senpi view of that profile #then only the invalid keys are dropped", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, {
      "[senpi]": { task: { host_engine_policy: 42, default_concurrency: 2 } },
      profiles: { fast: { task: { max_depth: -1, ttl_ms: 1000 }, agents: { explore: { model: "openai/gpt-6-luna" } } } },
    })

    // when
    const result = load(fixture, { harness: "senpi", profile: "fast" })

    // then
    expect(result.config.task?.default_concurrency).toBe(2)
    expect(result.config.task?.ttl_ms).toBe(1000)
    expect(result.config.task?.max_depth).toBe(1)
    expect(result.config.agents?.explore?.model).toBe("openai/gpt-6-luna")
    expect([...droppedKeys(result)].sort()).toEqual(["[senpi].task.host_engine_policy", "profiles.fast.task.max_depth"])
  })

  test("#given a project file whose every value is invalid beside a valid user file #when loading #then the project file contributes nothing and the user file still applies", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, { task: { default_concurrency: 4 } })
    const projectPath = writeProjectConfig(fixture, { task: { default_concurrency: "many" }, agents: { oracle: { model: 1 } } })

    // when
    const result = load(fixture)

    // then
    expect(result.config.task?.default_concurrency).toBe(4)
    expect(result.config.agents?.oracle).toBeUndefined()
    expect(result.sources.find((source) => source.path === projectPath)?.loaded).toBe(false)
    expect(result.layers.some((layer) => layer.source.path === projectPath)).toBe(false)
    expect(result.diagnostics).toEqual([expect.objectContaining({ kind: "validation", path: projectPath })])
  })

  test("#given a file whose root is not an object or that does not parse #when loading #then it contributes nothing and keeps its existing diagnostic", () => {
    // given
    const fixture = makeFixture()
    const userPath = writeUserConfig(fixture, "[1, 2]")
    const projectPath = writeProjectConfig(fixture, "{ \"task\": ")

    // when
    const result = load(fixture)

    // then
    expect(result.layers).toHaveLength(0)
    expect(result.config.task?.default_concurrency).toBe(5)
    expect(result.diagnostics.map((d) => [d.kind, d.path])).toEqual([["validation", userPath], ["parse", projectPath]])
  })

  test("#given a partial team spec that is valid per file but invalid once merged #when loading #then only that team is dropped instead of resetting the whole config", () => {
    // given
    const fixture = makeFixture()
    writeUserConfig(fixture, { teams: { alpha: { description: "no members yet" } }, task: { default_concurrency: 3 } })

    // when
    const result = load(fixture)

    // then
    expect(result.config.task?.default_concurrency).toBe(3)
    expect(result.config.teams?.alpha).toBeUndefined()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "invalid-value", path: MERGED_CONFIG_DIAGNOSTIC_PATH, issuePaths: ["teams.alpha"] }),
    ])
  })
})
