import { describe, expect, test } from "bun:test"
import { posix } from "node:path"

import { parseFile, MemoryMigrationFileSystem } from "../../omo-config-core/src/migration/migration-test-support"
import { runOpenCodeStartupMigration } from "./startup-migration"

const homeDir = "/home/alice"
const cwd = "/work/project"
const targetPath = `${homeDir}/.omo/omo.jsonc`
const rootSourcePath = `${homeDir}/.config/opencode/oh-my-openagent.json`
const configJsoncPath = `${homeDir}/.omo/config.jsonc`

function createFileSystem(): MemoryMigrationFileSystem {
  const fileSystem = new MemoryMigrationFileSystem()
  for (const directory of [
    homeDir,
    `${homeDir}/.config`,
    `${homeDir}/.config/opencode`,
    `${homeDir}/.omo`,
    "/work",
    cwd,
  ]) {
    fileSystem.directories.add(directory)
  }
  return fileSystem
}

function run(fileSystem: MemoryMigrationFileSystem, options: { readonly onBoundary?: (boundary: "target-written") => void } = {}) {
  return runOpenCodeStartupMigration({
    backupTimestamp: "2026-07-27T12-34-56-789Z",
    clock: { now: () => 1 },
    cwd,
    discoveryFileSystem: {
      existsSync: fileSystem.existsSync.bind(fileSystem),
      readdirSync: fileSystem.readdirSync.bind(fileSystem),
      realpathSync: (path) => path,
    },
    environment: { HOME: homeDir, XDG_CONFIG_HOME: `${homeDir}/.config` },
    env: { HOME: homeDir },
    fileSystem,
    homeDir,
    isProcessAlive: () => false,
    onBoundary: options.onBoundary,
    pathOperations: posix,
    pid: 100,
    platform: "linux",
  })
}

describe("runOpenCodeStartupMigration", () => {
  test("#given both legacy source groups #when startup migration runs #then it migrates, moves, and reports that the chain must reload", () => {
    // given
    const fileSystem = createFileSystem()
    fileSystem.files.set(rootSourcePath, JSON.stringify({ agents: { oracle: { model: "anthropic/legacy" } } }))
    fileSystem.files.set(configJsoncPath, JSON.stringify({ codegraph: { excluded_roots: ["/generated"] } }))

    // when
    const result = run(fileSystem)

    // then
    expect(result.reloadRequired).toBe(true)
    expect(result.migratedFrom).toEqual([rootSourcePath, configJsoncPath])
    expect(parseFile(fileSystem, targetPath)).toMatchObject({
      "[opencode]": { agents: { oracle: { model: "anthropic/legacy" } } },
      codegraph: { excluded_roots: ["/generated"] },
    })
    expect(fileSystem.existsSync(rootSourcePath)).toBe(false)
    expect(fileSystem.existsSync(configJsoncPath)).toBe(false)
    expect(fileSystem.existsSync(`${homeDir}/.omo/migration-backup-2026-07-27T12-34-56-789Z-opencode-config/.config/opencode/oh-my-openagent.json`)).toBe(true)
    expect(fileSystem.existsSync(`${homeDir}/.omo/migration-backup-2026-07-27T12-34-56-789Z-opencode-config/.omo/config.jsonc`)).toBe(true)
  })

  test("#given no legacy source #when startup migration runs #then it does not create a target or backups", () => {
    // given
    const fileSystem = createFileSystem()

    // when
    const result = run(fileSystem)

    // then
    expect(result.reloadRequired).toBe(false)
    expect(result.migratedFrom).toEqual([])
    expect(fileSystem.existsSync(targetPath)).toBe(false)
    expect([...fileSystem.files.keys()].filter((path) => path.includes("migration-backup"))).toEqual([])
  })

  test("#given an invalid transformed document #when startup migration runs #then validation aborts before target and source changes", () => {
    // given
    const fileSystem = createFileSystem()
    fileSystem.files.set(configJsoncPath, JSON.stringify({ codegraph: { excluded_roots: [42] } }))

    // when
    const result = run(fileSystem)

    // then
    expect(result.error).toContain("Migration validation failed")
    expect(fileSystem.existsSync(targetPath)).toBe(false)
    expect(fileSystem.existsSync(configJsoncPath)).toBe(true)
  })

  test("#given a crash after the target write #when the next startup runs #then it recovers before evaluating migration sources", () => {
    // given
    const fileSystem = createFileSystem()
    fileSystem.files.set(rootSourcePath, JSON.stringify({ agents: { oracle: { model: "anthropic/legacy" } } }))
    const crashed = run(fileSystem, { onBoundary: () => { throw new Error("crash after target write") } })
    expect(crashed.error).toBe("crash after target write")

    // when
    const recovered = run(fileSystem)

    // then
    expect(recovered.journalResumed).toBe(true)
    expect(recovered.reloadRequired).toBe(true)
    expect(recovered.migratedFrom).toEqual([])
    expect(fileSystem.existsSync(rootSourcePath)).toBe(false)
    expect(fileSystem.existsSync(`${homeDir}/.omo/.migration-journal.json`)).toBe(false)
    expect(parseFile(fileSystem, targetPath)._migrations).toEqual([
      "2026-07-opencode-config-unification",
      "2026-08-reasoning-unification",
    ])
  })
})
