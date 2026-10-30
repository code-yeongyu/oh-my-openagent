import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import fixtureExpected from "./2026-08-reasoning-unification/fixture-expected.json"
import fixtureInput from "./2026-08-reasoning-unification/fixture-input.json"
import { createLegacyConfigMigrationPlans, executeLegacyConfigMigrationPlan } from "./index"
import {
  REASONING_UNIFICATION_MIGRATION_ID,
  transformReasoningUnification,
} from "./reasoning-unification"

describe("2026-08 reasoning unification migration", () => {
  test("#given the canonical legacy fixture #when transformed #then rules one through eight match exact expected output", () => {
    // given
    const input = structuredClone(fixtureInput)

    // when
    const result = transformReasoningUnification(input)

    // then
    expect(REASONING_UNIFICATION_MIGRATION_ID).toBe("2026-08-reasoning-unification")
    expect(result.document).toEqual(fixtureExpected)
    expect(result.diagnostics).toContain('conflict: categories.conflict dropped variant="high" kept reasoningEffort="xhigh"')
  })

  test("#given canonical reasoning outranking legacy keys #when transformed #then the journal reports reasoning as the winner", () => {
    // given
    const input = { categories: { odd: { model: "a/m", reasoning: "low", reasoningEffort: "xhigh", variant: "high" } } }

    // when
    const result = transformReasoningUnification(input)

    // then the migrated value is the canonical winner, and the journal does not claim the legacy key won
    expect(result.document.categories?.odd).toMatchObject({ reasoning: "low" })
    const journal = result.diagnostics.find((entry) => entry.includes("conflict")) ?? ""
    expect(journal).not.toContain('kept reasoningEffort="xhigh"')
  })

  test("#given an existing user omo config #when planned and executed #then dry-run, backup, journaled execution, and marker use the existing engine", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-reasoning-migration-"))
    const homeDir = join(root, "home")
    const targetPath = join(homeDir, ".omo", "omo.jsonc")
    mkdirSync(join(homeDir, ".omo"), { recursive: true })
    writeFileSync(targetPath, JSON.stringify(fixtureInput, null, 2))

    try {
      const plans = createLegacyConfigMigrationPlans({
        backupTimestamp: "2026-08-01T00-00-00-000Z",
        cwd: homeDir,
        environment: { HOME: homeDir },
        homeDir,
        pathOperations: posix,
        platform: "linux",
      })
      const plan = plans.find((candidate) => candidate.id === REASONING_UNIFICATION_MIGRATION_ID)
      if (plan === undefined) throw new Error("Expected reasoning migration plan")

      // when
      const dryRun = executeLegacyConfigMigrationPlan(plan, { dryRun: true, env: { HOME: homeDir } })
      let journalDiagnostics: unknown
      const migrated = executeLegacyConfigMigrationPlan(plan, {
        env: { HOME: homeDir },
        onBoundary: (boundary) => {
          if (boundary !== "journal-written") return
          const journal = JSON.parse(readFileSync(join(homeDir, ".omo", ".migration-journal.json"), "utf-8")) as Record<string, unknown>
          journalDiagnostics = journal["diagnostics"]
        },
      })
      const document = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<string, unknown>

      // then
      expect(dryRun.status).toBe("planned")
      expect(dryRun.preview?.transform).toEqual(fixtureExpected)
      expect(migrated.status).toBe("migrated")
      expect(document).toEqual({ ...fixtureExpected, _migrations: [REASONING_UNIFICATION_MIGRATION_ID] })
      expect(journalDiagnostics).toContain('conflict: categories.conflict dropped variant="high" kept reasoningEffort="xhigh"')
      expect(readdirSync(join(homeDir, ".omo")).some((name) => name.startsWith("omo.jsonc.bak."))).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test("#given typed harness blocks, profiles, and unrelated opencode values #when transformed #then typed records recurse and opencode rewrites only known agent and category keys", () => {
    // given
    const input = {
      "[senpi]": { categories: { deep: { model: "p/m high", variant: "low" } } },
      "[codex]": { agents: { oracle: { model: "p/m", reasoningEffort: "none" } } },
      "[opencode]": {
        agents: { oracle: { variant: "high", native: { variant: "untouched" } } },
        categories: { quick: { textVerbosity: "low" } },
        provider: { variant: "untouched" },
      },
      profiles: {
        focused: { categories: { deep: { model: "p/m(xhigh)", maxTokens: 1 } } },
      },
    }

    // when
    const result = transformReasoningUnification(input)

    // then
    expect(result.document).toEqual({
      "[senpi]": { categories: { deep: { model: "p/m:high", reasoning: "low" } } },
      "[codex]": { agents: { oracle: { model: "p/m", reasoning: "off" } } },
      "[opencode]": {
        agents: { oracle: { reasoning: "high", native: { variant: "untouched" } } },
        categories: { quick: { textVerbosity: "low" } },
        provider: { variant: "untouched" },
      },
      profiles: {
        focused: { categories: { deep: { model: "p/m:xhigh", max_tokens: 1 } } },
      },
    })
  })
})
