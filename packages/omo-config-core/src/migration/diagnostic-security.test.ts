import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { loadOmoConfig, runMigration } from "../index"
import { invalidValueDiagnostics, validateConfigLayer } from "../loader/layer-validation"
import { pruneInvalidConfigPaths } from "../loader/prune-invalid-leaves"
import { readMigrationJournal } from "./journal"
import { DEFAULT_MIGRATION_FILE_SYSTEM } from "./types"
import { OmoConfigWriteError } from "../writer/types"

const secret = "sk-test-DO-NOT-PRINT-0000"
const token = "eyJhbGciOiJub25lIn0.DO-NOT-PRINT.signature"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "omo-diagnostic-security-"))
  roots.push(home)
  const targetPath = join(home, ".omo", "omo.jsonc")
  const sourcePath = join(home, "legacy.jsonc")
  mkdirSync(dirname(targetPath), { recursive: true })
  const target = { "[opencode]": { provider: { custom: { apiKey: token } } } }
  writeFileSync(targetPath, JSON.stringify(target))
  writeFileSync(sourcePath, JSON.stringify({ apiKey: secret }))
  return { home, targetPath, sourcePath }
}

function noSecrets(value: unknown) {
  const text = JSON.stringify(value)
  expect(text).not.toContain(secret)
  expect(text).not.toContain(token)
}

describe("config diagnostic security", () => {
  test("conflicts and on-disk journal diagnostics never include either credential", () => {
    const { home, sourcePath, targetPath } = fixture()
    let journalObserved = false
    const result = runMigration({
      env: { HOME: home },
      id: "security-test",
      sources: [{ path: sourcePath }],
      targetPath,
      transform: () => ({ "[opencode]": { provider: { custom: { apiKey: secret } } } }),
      onBoundary: (boundary) => {
        if (boundary !== "journal-written") return
        journalObserved = true
        const journal = JSON.parse(readFileSync(join(home, ".omo", ".migration-journal.json"), "utf8"))
        // Recovery needs the original transform, so only diagnostics are public-safe.
        expect(journal.targetWrite.additions["[opencode]"].provider.custom.apiKey).toBe(secret)
        noSecrets(journal.diagnostics)
      },
    })
    expect(journalObserved).toBe(true)
    noSecrets(result.diagnostics)
    expect(result.diagnostics.join("\n")).toContain("[opencode].provider.custom.apiKey")
    expect(JSON.parse(readFileSync(targetPath, "utf8"))["[opencode]"].provider.custom.apiKey).toBe(token)
    expect(DEFAULT_MIGRATION_FILE_SYSTEM.existsSync(join(home, ".omo", ".migration-journal.json"))).toBe(false)
  })

  test("journal, target backups and legacy backups are private under a permissive umask", () => {
    if (process.platform === "win32") return
    const { home, sourcePath, targetPath } = fixture()
    const backupPath = join(home, ".omo", "migration-backup-test", "nested", "legacy.jsonc")
    const previousUmask = process.umask(0)
    let observed = false
    try {
      const result = runMigration({
        env: { HOME: home },
        id: "security-modes",
        sources: [{ path: sourcePath, backupPath }],
        targetPath,
        transform: () => ({ task: { default_concurrency: 3 } }),
        onBoundary: (boundary) => {
          if (boundary !== "journal-written") return
          observed = true
          expect(statSync(join(home, ".omo", ".migration-journal.json")).mode & 0o777).toBe(0o600)
        },
      })
      expect(observed).toBe(true)
      expect(statSync(join(home, ".omo", "migration-backup-test")).mode & 0o777).toBe(0o700)
      expect(statSync(dirname(backupPath)).mode & 0o777).toBe(0o700)
      expect(statSync(backupPath).mode & 0o777).toBe(0o600)
      expect(result.targetBackupPath).toBeDefined()
      expect(statSync(result.targetBackupPath!).mode & 0o777).toBe(0o600)
    } finally {
      process.umask(previousUmask)
    }
  })

  test("malformed journal errors never quote the journal bytes", () => {
    const { home } = fixture()
    writeFileSync(join(home, ".omo", ".migration-journal.json"), `{"token":${secret}}`)
    let error: unknown
    try {
      readMigrationJournal(DEFAULT_MIGRATION_FILE_SYSTEM, { HOME: home })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    noSecrets(String(error))
    expect(String(error)).toContain(".migration-journal.json")
  })

  test("schema diagnostics discard received values and custom validator messages", () => {
    const issue = { code: "custom" as const, path: ["task", "default_concurrency"], message: `Received ${secret} and ${token}` }
    const pruned = pruneInvalidConfigPaths(
      { task: { default_concurrency: secret }, categories: {} },
      [issue],
      () => ({ success: true }),
    )
    expect(pruned.ok).toBe(true)
    noSecrets(pruned.dropped)
    noSecrets(invalidValueDiagnostics("omo.jsonc", pruned.dropped))
    const layer = validateConfigLayer("omo.jsonc", { categories: {}, unexpected: { apiKey: secret }, task: { default_concurrency: token } })
    noSecrets(layer.diagnostics)
    expect(layer.diagnostics.flatMap((diagnostic) => diagnostic.issuePaths ?? [])).toContain("unexpected")
  })

  test("loader read failures do not echo arbitrary exception content", () => {
    const { home, targetPath } = fixture()
    const result = loadOmoConfig({
      cwd: home,
      env: { HOME: home },
      fileSystem: {
        existsSync: (path) => path === targetPath,
        readFileSync: () => { throw Object.assign(new Error(secret), { code: "EACCES" }) },
      },
    })
    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "read")).toBe(true)
    expect(result.diagnostics[0]?.message).toContain("EACCES")
    noSecrets(result.diagnostics)
  })

  test("writer errors retain the file and operation but not arbitrary causes", () => {
    const error = new OmoConfigWriteError("omo.jsonc", "parse", new SyntaxError(secret))
    expect(error.message).toContain("omo.jsonc")
    expect(error.message).toContain("parse")
    noSecrets(error.message)
  })
})
