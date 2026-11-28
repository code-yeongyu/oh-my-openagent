import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadOmoConfig, type LoadOmoConfigOptions } from "../index"

type Fixture = {
  readonly cwd: string
  readonly homeDir: string
  readonly projectFile: string
  readonly userFile: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeFixture(user: unknown, project?: unknown): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-config-atomic-policy-"))
  roots.push(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  const userFile = join(homeDir, ".omo", "omo.jsonc")
  const projectFile = join(cwd, ".omo", "omo.jsonc")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  if (user !== undefined) writeFileSync(userFile, JSON.stringify(user))
  if (project !== undefined) writeFileSync(projectFile, JSON.stringify(project))
  return { cwd, homeDir, projectFile, userFile }
}

function load(
  fixture: Fixture,
  options: Omit<LoadOmoConfigOptions, "cwd" | "env" | "platform"> & { readonly profile?: string } = {},
) {
  return loadOmoConfig({ ...options, cwd: fixture.cwd, env: { HOME: fixture.homeDir }, platform: "linux" })
}

const OFF_PATH_USER = {
  task: { max_depth: 4 },
  telemetry: { enabled: false },
  "[native]": { task: { default_concurrency: 3 } },
  "[codex]": { telemetry: {} },
}

// Resolved senpi config for OFF_PATH_USER, captured from origin/dev eb6f16df59 before `atomic` existed.
const ORIGIN_DEV_SENPI_CONFIG = {
  categories: {},
  agents: {},
  task: {
    isolation: { enabled: false, backend: "auto", apply: true, merge: "patch", commits: "generic" },
    default_execution_mode: "auto",
    process_runner: "host",
    host_engine_policy: "upgrade",
    host_shard_prewarm: "first-turn",
    default_concurrency: 3,
    global_concurrency: 32,
    max_depth: 4,
    residency_max_children: "unlimited",
    resident_idle_timeout_ms: 900_000,
    ttl_ms: 86_400_000,
    resume_children: true,
    warnings: { unavailable_categories: true },
    wait: { min_ms: 5000, default_ms: 60_000, max_ms: 600_000 },
    team: { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
  },
  teams: {},
  telemetry: { enabled: false },
} as const

describe("loadOmoConfig atomic off path", () => {
  test("#given atomic absent #when loading senpi #then the resolved config equals the origin/dev capture", () => {
    // given
    const fixture = makeFixture(OFF_PATH_USER)

    // when
    const result = load(fixture, { harness: "senpi" })

    // then
    expect(result.config).toEqual(ORIGIN_DEV_SENPI_CONFIG)
  })

  test.each([[undefined], ["senpi"], ["codex"], ["opencode"]] as const)(
    "#given atomic absent, false, or enabled only by the project #when loading harness %s #then every resolved config is identical",
    (harness) => {
      // given
      const absent = makeFixture(OFF_PATH_USER)
      const disabled = makeFixture({ ...OFF_PATH_USER, atomic: { enabled: false, context: { limit: 3 } } })
      const projectAttempt = makeFixture(OFF_PATH_USER, {
        atomic: { enabled: true, binary_path: "/tmp/evil/atomic" },
        "[opencode]": { atomic: { enabled: true } },
      })
      const options = harness === undefined ? {} : { harness }

      // when
      const results = [absent, disabled, projectAttempt].map((fixture) => load(fixture, options).config)

      // then
      expect(results[0]).not.toHaveProperty("atomic")
      expect(results[1]).toEqual(results[0])
      expect(results[2]).toEqual(results[0])
    },
  )
})

describe("loadOmoConfig atomic authorization", () => {
  test("#given the user config enables atomic #when loading #then the resolved settings carry every default", () => {
    // given
    const fixture = makeFixture({ atomic: { enabled: true, binary_path: "/opt/atomic/bin/atomic" } })

    // when
    const result = load(fixture, { harness: "senpi" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.atomic).toEqual({
      enabled: true,
      binary_path: "/opt/atomic/bin/atomic",
      context: { enabled: true, limit: 5, budget_chars: 8000, timeout_ms: 1000, cache_ttl_ms: 15_000 },
      recording: { enabled: true, owner: "auto", timeout_ms: 30_000 },
    })
  })

  test("#given only a project config enabling atomic with a binary_path #when loading #then nothing is authorized and each key is reported against the project file", () => {
    // given
    const fixture = makeFixture(undefined, {
      atomic: { enabled: true, binary_path: "/tmp/evil/atomic", recording: { owner: "omo" } },
    })

    // when
    const result = load(fixture, { harness: "codex" })

    // then
    expect(result.config.atomic).toBeUndefined()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        kind: "unauthorized-setting",
        path: fixture.projectFile,
        issuePaths: ["atomic.enabled"],
      }),
      expect.objectContaining({
        kind: "unauthorized-setting",
        path: fixture.projectFile,
        issuePaths: ["atomic.binary_path"],
      }),
      expect.objectContaining({
        kind: "unauthorized-setting",
        path: fixture.projectFile,
        issuePaths: ["atomic.recording"],
      }),
    ])
  })

  test("#given a user that enables atomic and a project that swaps the binary #when loading #then the user binary wins", () => {
    // given
    const fixture = makeFixture(
      { atomic: { enabled: true, binary_path: "/opt/atomic/bin/atomic" } },
      { atomic: { binary_path: "/tmp/evil/atomic" } },
    )

    // when
    const result = load(fixture)

    // then
    expect(result.config.atomic?.binary_path).toBe("/opt/atomic/bin/atomic")
    expect(result.diagnostics.map((diagnostic) => diagnostic.issuePaths)).toEqual([["atomic.binary_path"]])
  })

  test("#given project profile and harness blocks enabling atomic #when loading that harness and profile #then they grant no authority", () => {
    // given
    const fixture = makeFixture(
      { profiles: { opus: {} } },
      {
        "[native]": { atomic: { enabled: true } },
        profiles: { opus: { atomic: { enabled: true }, "[native]": { atomic: { binary_path: "/tmp/evil" } } } },
      },
    )

    // when
    const result = load(fixture, { harness: "senpi", profile: "opus" })

    // then
    expect(result.config.atomic).toBeUndefined()
    expect(result.diagnostics.flatMap((diagnostic) => diagnostic.issuePaths)).toEqual([
      "[native].atomic.enabled",
      "profiles.opus.atomic.enabled",
      "profiles.opus.[native].atomic.binary_path",
    ])
  })

  test("#given user base, harness, profile and profile-harness context limits #when loading #then they fold in precedence order per harness", () => {
    // given
    const fixture = makeFixture({
      atomic: { enabled: true, context: { limit: 10 } },
      "[native]": { atomic: { context: { limit: 8 } } },
      profiles: { opus: { atomic: { context: { limit: 6 } }, "[native]": { atomic: { context: { limit: 4 } } } } },
    })

    // when
    const senpi = load(fixture, { harness: "senpi", profile: "opus" })
    const codex = load(fixture, { harness: "codex", profile: "opus" })
    const senpiBase = load(fixture, { harness: "senpi" })

    // then
    expect(senpi.config.atomic?.context.limit).toBe(4)
    expect(codex.config.atomic?.context.limit).toBe(6)
    expect(senpiBase.config.atomic?.context.limit).toBe(8)
  })

  test("#given a user-only [native] enablement #when loading the senpi harness #then the harness block authorizes", () => {
    // given
    const fixture = makeFixture({ "[native]": { atomic: { enabled: true } } })

    // when
    const senpi = load(fixture, { harness: "senpi" })
    const codex = load(fixture, { harness: "codex" })

    // then
    expect(senpi.config.atomic?.enabled).toBe(true)
    expect(codex.config.atomic).toBeUndefined()
  })

  test("#given project context values #when loading #then each limit is the minimum and enabled is the conjunction", () => {
    // given
    const fixture = makeFixture(
      { atomic: { enabled: true, context: { limit: 10, budget_chars: 4000, timeout_ms: 2000 } } },
      { atomic: { context: { enabled: false, limit: 3, budget_chars: 9000, cache_ttl_ms: 0 } } },
    )

    // when
    const result = load(fixture)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.atomic?.context).toEqual({
      enabled: false,
      limit: 3,
      budget_chars: 4000,
      timeout_ms: 2000,
      cache_ttl_ms: 0,
    })
  })

  test("#given a user that disabled context and a project that enables it #when loading #then context stays disabled", () => {
    // given
    const fixture = makeFixture(
      { atomic: { enabled: true, context: { enabled: false } } },
      { atomic: { context: { enabled: true, limit: 20 } } },
    )

    // when
    const result = load(fixture)

    // then
    expect(result.config.atomic?.context).toMatchObject({ enabled: false, limit: 5 })
  })

  test("#given an invalid [opencode].atomic block #when loading the opencode harness #then the invalid and unknown values are dropped with file-qualified diagnostics", () => {
    // given
    const fixture = makeFixture({
      "[opencode]": {
        atomic: { enabled: true, context: { limit: 99, budget_chars: 512 }, isolation: { enabled: true } },
      },
    })

    // when
    const result = load(fixture, { harness: "opencode" })

    // then
    expect(result.config.atomic).toMatchObject({ enabled: true, context: { limit: 5, budget_chars: 512 } })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        kind: "unknown-keys",
        path: fixture.userFile,
        issuePaths: ["[opencode].atomic.isolation"],
      }),
      expect.objectContaining({
        kind: "invalid-value",
        path: fixture.userFile,
        issuePaths: ["[opencode].atomic.context.limit"],
      }),
    ])
  })

  test("#given an invalid project [opencode].atomic enablement #when loading the opencode harness #then it is neither authorized nor applied", () => {
    // given
    const fixture = makeFixture(undefined, { "[opencode]": { atomic: { enabled: "yes", binary_path: "/tmp/evil" } } })

    // when
    const result = load(fixture, { harness: "opencode" })

    // then
    expect(result.config.atomic).toBeUndefined()
    expect(result.diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.issuePaths])).toEqual([
      ["invalid-value", ["[opencode].atomic.enabled"]],
      ["unauthorized-setting", ["[opencode].atomic.binary_path"]],
    ])
  })
})
