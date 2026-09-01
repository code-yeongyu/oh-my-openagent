import { describe, expect, test } from "bun:test"
import { posix } from "node:path"

import {
  runMigrations,
  type MigrationBatchRunResult,
  type MigrationFileSystem,
} from "@oh-my-opencode/omo-config-core"
import { createLegacyConfigMigrationPlans } from "@oh-my-opencode/omo-opencode/config-migration"
import { parse } from "jsonc-parser"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { createConfigStartupComponent, runSenpiStartupMigration, type SenpiStartupMigrationResult } from "./index"

function fileError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function memoryFileSystem() {
  const directories = new Set<string>()
  const files = new Map<string, string>()
  const key = (path: string): string => posix.normalize(path)
  const fileSystem: MigrationFileSystem & {
    readonly files: Map<string, string>
    readonly realpathSync: (path: string) => string
  } = {
    files,
    copyFileSync(source, destination) { files.set(key(destination), this.readFileSync(source, "utf-8")) },
    existsSync(path) { return files.has(key(path)) || directories.has(key(path)) },
    lstatSync() { return { isSymbolicLink: () => false } },
    mkdirSync(path) { directories.add(key(path)); return undefined },
    readFileSync(path) {
      const content = files.get(key(path))
      if (content === undefined) throw fileError("ENOENT", `Missing ${path}`)
      return content
    },
    readdirSync(path) {
      const prefix = `${key(path).replace(/\/$/u, "")}/`
      const names = new Set<string>()
      for (const candidate of [...files.keys(), ...directories]) {
        if (!candidate.startsWith(prefix)) continue
        const name = candidate.slice(prefix.length).split("/")[0]
        if (name.length > 0) names.add(name)
      }
      return [...names]
    },
    removeIfContentsMatchSync(path, expected) {
      if (files.get(key(path)) !== expected) return false
      files.delete(key(path))
      return true
    },
    renameSync(from, to) {
      const content = this.readFileSync(from, "utf-8")
      files.set(key(to), content)
      files.delete(key(from))
    },
    replaceIfContentsMatchSync(path, expected, content) {
      if (files.get(key(path)) !== expected) return false
      files.set(key(path), content)
      return true
    },
    unlinkSync(path) {
      if (!files.delete(key(path))) throw fileError("ENOENT", `Missing ${path}`)
    },
    writeFileExclusiveSync(path, content) {
      if (files.has(key(path))) throw fileError("EEXIST", `Exists ${path}`)
      files.set(key(path), content)
    },
    writeFileSync(path, content) { files.set(key(path), content) },
    realpathSync(path) {
      if (!this.existsSync(path)) throw fileError("ENOENT", `Missing ${path}`)
      return key(path)
    },
  }
  return fileSystem
}

function withProcessPlatform<T>(platform: NodeJS.Platform, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")
  if (descriptor === undefined) throw new Error("Missing process.platform descriptor")
  Object.defineProperty(process, "platform", { ...descriptor, value: platform })
  try {
    return callback()
  } finally {
    Object.defineProperty(process, "platform", descriptor)
  }
}

function migrationOptions(fileSystem: ReturnType<typeof memoryFileSystem>) {
  return {
    clock: { now: () => 1_000 },
    cwd: "/home/alice/project",
    discoveryFileSystem: fileSystem,
    env: { HOME: "/home/alice" },
    environment: { HOME: "/home/alice", XDG_CONFIG_HOME: "/home/alice/.config" },
    fileSystem,
    homeDir: "/home/alice",
    isProcessAlive: () => true,
    pathOperations: posix,
    pid: 41,
    platform: "linux" as const,
  }
}

describe("runSenpiStartupMigration", () => {
  test("#given both legacy source groups without an OpenCode boot #when Senpi starts #then the core migration engine migrates both into the unified config", () => {
    // given
    const fileSystem = memoryFileSystem()
    fileSystem.files.set("/home/alice/.config/opencode/oh-my-openagent.jsonc", '{"agents":{"finder":{"model":"provider/finder"}}}')
    fileSystem.files.set("/home/alice/.omo/config.jsonc", '{"codegraph":{"daemon":false}}')

    // when
    const result = withProcessPlatform("win32", () => runSenpiStartupMigration(migrationOptions(fileSystem)))

    // then
    expect(result.error).toBeUndefined()
    expect(result.results.map((entry) => entry.status)).toEqual(["migrated", "migrated", "migrated"])
    expect(parse(fileSystem.readFileSync("/home/alice/.omo/omo.jsonc", "utf-8"))).toMatchObject({
      _migrations: [
        "2026-07-opencode-config-unification",
        "2026-07-codex-config-jsonc",
        "2026-08-reasoning-unification",
      ],
      codegraph: { daemon: false },
    })
  })

  test("#given OpenCode and Senpi race on the first legacy migration #when Senpi holds the injected core lock #then exactly one caller migrates", () => {
    // given
    const fileSystem = memoryFileSystem()
    fileSystem.files.set("/home/alice/.config/opencode/oh-my-openagent.jsonc", '{"agents":{"finder":{"model":"provider/finder"}}}')
    const options = migrationOptions(fileSystem)
    let opencodeResult: MigrationBatchRunResult | undefined
    let raced = false

    // when
    const senpiResult = withProcessPlatform("win32", () => runSenpiStartupMigration({
      ...options,
      onBoundary: (boundary) => {
        if (boundary !== "journal-written" || raced) return
        raced = true
        opencodeResult = runMigrations({
          clock: options.clock,
          discover: () => createLegacyConfigMigrationPlans({
            cwd: options.cwd,
            environment: options.environment,
            fileSystem,
            homeDir: options.homeDir,
            pathOperations: posix,
            platform: options.platform,
          }),
          env: options.env,
          fileSystem,
          isProcessAlive: options.isProcessAlive,
          pid: 42,
        })
      },
    }))

    // then
    if (opencodeResult === undefined) throw new Error("Expected OpenCode race result")
    expect(opencodeResult.status).toBe("locked")
    expect(opencodeResult.results.filter((entry) => entry.status === "migrated")).toHaveLength(0)
    expect(senpiResult.results.filter((entry) => entry.status === "migrated")).toHaveLength(2)
    expect(parse(fileSystem.readFileSync("/home/alice/.omo/omo.jsonc", "utf-8"))._migrations).toEqual([
      "2026-07-opencode-config-unification",
      "2026-08-reasoning-unification",
    ])
  })
})

function context(logs: string[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: { error() {}, info: (message) => logs.push(`info:${message}`), warn: (message) => logs.push(`warn:${message}`) },
  }
}

describe("createConfigStartupComponent", () => {
  test("#given migration results and config diagnostics #when session_start captures a UI #then it reports both once through that UI", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logs: string[] = []
    const migration: SenpiStartupMigrationResult = {
      journalResumed: false,
      migratedFrom: ["/home/alice/.config/opencode/oh-my-openagent.jsonc"],
      results: [],
    }
    const config: SenpiOmoConfigResult = {
      config: {},
      diagnostics: [{ kind: "parse", message: "JSONC parse error", path: "/home/alice/.omo/omo.jsonc" }],
      layers: [],
      sources: [],
    }
    createConfigStartupComponent({
      loadConfig: () => config,
      resolveCwd: () => "/project",
      runMigration: () => migration,
    }).register(pi, context(logs))
    const notifications: Array<{ message: string; type: string | undefined }> = []
    const eventContext = { ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) } }

    // when
    await pi.dispatch("session_start", {}, eventContext)
    await pi.dispatch("session_start", {}, eventContext)

    // then
    expect(notifications).toEqual([
      {
        message: "omo-senpi: migrated legacy configuration from /home/alice/.config/opencode/oh-my-openagent.jsonc",
        type: "info",
      },
      { message: "omo-senpi: configuration diagnostics: JSONC parse error", type: "warning" },
    ])
    expect(logs).toEqual([])
  })

  test("#given a migration target with a conflicting provider setting #when session_start captures a UI #then it reports the skipped-conflict diagnostic once", async () => {
    // given
    const fileSystem = memoryFileSystem()
    fileSystem.files.set("/home/alice/.config/opencode/oh-my-openagent.jsonc", '{"model_fallback":true}')
    fileSystem.files.set("/home/alice/.omo/omo.jsonc", '{"[opencode]":{"model_fallback":false}}')
    const migration = runSenpiStartupMigration(migrationOptions(fileSystem))
    const pi = new FakeExtensionAPI()
    const logs: string[] = []
    createConfigStartupComponent({
      loadConfig: () => ({ config: {}, diagnostics: [], layers: [], sources: [] }),
      resolveCwd: () => "/project",
      runMigration: () => migration,
    }).register(pi, context(logs))
    const notifications: Array<{ message: string; type: string | undefined }> = []
    const eventContext = { ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) } }

    // when
    await pi.dispatch("session_start", {}, eventContext)
    await pi.dispatch("session_start", {}, eventContext)

    // then
    expect(notifications).toEqual([
      {
        message: "omo-senpi: migrated legacy configuration from /home/alice/.config/opencode/oh-my-openagent.jsonc",
        type: "info",
      },
      {
        message: "omo-senpi: configuration migration: skipped: [opencode].model_fallback legacy=true kept=false",
        type: "warning",
      },
    ])
    expect(logs).toEqual([])
  })

  test("#given config diagnostics without a UI #when session_start fires #then it logs a single fallback warning", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logs: string[] = []
    const config: SenpiOmoConfigResult = {
      config: {},
      diagnostics: [{ kind: "validation", message: "Invalid omo config", path: "/project/.omo/omo.jsonc" }],
      layers: [],
      sources: [],
    }
    createConfigStartupComponent({
      loadConfig: () => config,
      resolveCwd: () => "/project",
      runMigration: () => ({ journalResumed: false, migratedFrom: [], results: [] }),
    }).register(pi, context(logs))

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("session_start", {})

    // then
    expect(logs).toEqual(["warn:omo-senpi: configuration diagnostics: Invalid omo config"])
  })
})
