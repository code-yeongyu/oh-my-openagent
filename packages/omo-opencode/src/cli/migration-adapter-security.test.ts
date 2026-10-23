import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runOpenCodeStartupMigration } from "../startup-migration"
import { runCodexConfigMigration } from "../../../omo-codex/plugin/shared/src/config-migration"
import { runSenpiStartupMigration } from "../../../omo-senpi/src/components/config-startup"
import { configIssueSummary } from "../../../omo-config-core/src/loader/diagnostic-values"
import { z } from "zod"

test("all startup adapters discard arbitrary exception messages but retain fixed symlink guidance", () => {
  const home = mkdtempSync(join(tmpdir(), "adapter-config-security-"))
  const secret = "sk-test-ADAPTER-DO-NOT-PRINT"
  try {
    mkdirSync(join(home, ".omo"))
    writeFileSync(join(home, ".omo", "config.jsonc"), '{"[opencode]":{}}')
    const options = { cwd: home, homeDir: home, environment: { HOME: home }, env: { HOME: home }, onBoundary: () => { throw new Error(secret) } }
    for (const run of [runOpenCodeStartupMigration, runCodexConfigMigration, runSenpiStartupMigration]) {
      const result = run(options)
      expect(result.error).toBeDefined()
      expect(result.error).not.toContain(secret)
      rmSync(join(home, ".omo", ".migration-journal.json"), { force: true })
    }
    if (process.platform === "win32") return
    writeFileSync(join(home, "real.jsonc"), "{}")
    symlinkSync(join(home, "real.jsonc"), join(home, ".omo", "omo.jsonc"))
    const result = runOpenCodeStartupMigration({ ...options, onBoundary: () => {} })
    expect(result.error).toContain("Refusing to edit symlinked omo config")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("safe schema codes remain actionable even if a custom message contains a credential", () => {
  const secret = "sk-test-SCHEMA-DO-NOT-PRINT"
  const schemas = [z.string().min(10, secret), z.string().max(0, secret), z.string().email(secret), z.strictObject({})]
  const values = ["x", "long", "invalid", { extra: secret }]
  for (let index = 0; index < schemas.length; index++) {
    const result = schemas[index]?.safeParse(values[index])
    expect(result?.success).toBe(false)
    if (!result || result.success) throw new Error("Expected an invalid fixture")
    for (const issue of result.error.issues) {
      expect(configIssueSummary(issue)).not.toBe("Invalid value")
      expect(configIssueSummary(issue)).not.toContain(secret)
    }
  }
})
