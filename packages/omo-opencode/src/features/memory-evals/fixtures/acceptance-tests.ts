import type { EvalFixture, EvalResult } from "../harness"
import { ClaudeMemL1Adapter } from "../../memory-provider-claude-mem/adapter"

export const sessionResumeFixture: EvalFixture = {
  name: "acceptance-test-1-session-resume",
  description: "L1 adapter isAvailable() returns gracefully without throwing",
  async run(): Promise<EvalResult> {
    try {
      const adapter = new ClaudeMemL1Adapter({
        sqliteDbPath: ":memory:",
      })
      const available = await adapter.isAvailable()
      return {
        fixture: this.name,
        passed: true,
        score: 1.0,
        details: `isAvailable() returned ${available} without throwing (non-blocking, graceful degradation)`,
      }
    } catch (err) {
      return {
        fixture: this.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}

export const providerIsolationFixture: EvalFixture = {
  name: "acceptance-test-5-provider-isolation",
  description: "Mem0 provider handles missing API key gracefully",
  async run(): Promise<EvalResult> {
    try {
      const { Mem0L2Adapter } = await import("../../memory-provider-mem0/adapter")
      const adapter = new Mem0L2Adapter({
        clientConfig: { apiKey: "" },
        projectId: "test-project",
      })
      const available = await adapter.isAvailable()
      return {
        fixture: this.name,
        passed: !available,
        score: !available ? 1.0 : 0.0,
        details: `isAvailable() with empty apiKey returned ${available} (expected false)`,
      }
    } catch (err) {
      return {
        fixture: this.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}

export const obsidianProjectionFixture: EvalFixture = {
  name: "acceptance-test-6-obsidian-projection",
  description: "Memory projects to Obsidian omo/ subdirectory with stable filename",
  async run(): Promise<EvalResult> {
    try {
      const { tmpdir } = await import("node:os")
      const { join } = await import("node:path")
      const { mkdirSync, rmSync, existsSync } = await import("node:fs")
      const { syncMemoryToObsidian } = await import("../../memory-obsidian-sync/sync-worker")

      const vault_path = join(tmpdir(), `eval-vault-${Date.now()}`)
      mkdirSync(vault_path, { recursive: true })

      try {
        const now = new Date().toISOString()
        const memory = {
          memory_id: "m_eval_test",
          project_id: "p_1",
          memory_type: "decision" as const,
          title: "Test decision",
          summary: "Test summary",
          why_it_matters: "Testing",
          scope: "test",
          evidence: [],
          tags: ["test"],
          status: "active" as const,
          confidence: 0.9,
          source_kind: "session" as const,
          source_refs: {},
          created_by: "eval",
          created_at: now,
          updated_at: now,
          promotion_origin: "L1" as const,
          provider_name: "mem0",
          provider_external_id: "ext_1",
        }

        const result = await syncMemoryToObsidian(memory, vault_path)
        const note_path = join(vault_path, "omo", "memories", "m_eval_test.md")

        const written = result.written && existsSync(note_path)
        const stable_filename = note_path.endsWith("m_eval_test.md")

        return {
          fixture: this.name,
          passed: written && stable_filename,
          score: written && stable_filename ? 1.0 : 0.0,
          details: `Note written: ${written}, stable filename: ${stable_filename}, path: ${result.note_path ?? "(none)"}`,
        }
      } finally {
        rmSync(vault_path, { recursive: true, force: true })
      }
    } catch (err) {
      return {
        fixture: this.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}

export const ACCEPTANCE_FIXTURES: EvalFixture[] = [
  sessionResumeFixture,
  providerIsolationFixture,
  obsidianProjectionFixture,
]
