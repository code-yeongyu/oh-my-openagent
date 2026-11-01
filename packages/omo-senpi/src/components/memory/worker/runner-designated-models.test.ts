import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoMemorySettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import { rmSyncEfaultTolerant } from "../teardown.test-support"
import { createRunnerHarness } from "./runner.test-support"

// The reflection worker runs only on the models designated for its category, never on the parent
// session's model, even when every designated model is gone (#12081, same rule as #12010).

const roots: string[] = []

// Each launching case starts a real supervisor and child process; match the supervisor suites.
setDefaultTimeout(60_000)

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const KIMI = { input: 0.60, cacheRead: 0.15, output: 2.50 }
const LUNA = { input: 0.25, cacheRead: 0.025, output: 2.00 }
const OPUS = { input: 5.00, cacheRead: 0.50, output: 25.0 }

const SESSION_MODEL = "openai/gpt-5.6-luna-fast"
const DESIGNATED_MODEL = "kimi/kimi-for-coding-highspeed"

function quickPinnedTo(model: string): OmoConfig {
  return {
    memory: OmoMemorySettingsSchema.parse({ reflection: { category: "quick", timeout_minutes: 15, merge: "auto" } }),
    categories: { quick: { model } },
  }
}

function parentSessionFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "parent-session-"))
  roots.push(dir)
  const file = join(dir, "parent.jsonl")
  writeFileSync(file, `${JSON.stringify({ type: "session", id: "parent-1", timestamp: new Date().toISOString(), cwd: "/parent/project" })}\n`, "utf8")
  return file
}

describe("reflection runs only on its designated models", () => {
  describe("#given every designated model is unavailable and a session model is live", () => {
    test("#when launched #then no child runs on the session model and the receipt names each model tried and why", async () => {
      // given
      const harness = await createRunnerHarness({
        childMode: "commit",
        categoryAvailable: false,
        resolveSessionModel: () => ({ provider: "anthropic", id: "claude-opus-5-5" }),
      })
      roots.push(harness.root)

      // when
      const result = await harness.runner.launch(harness.run)

      // then
      expect(harness.spawnCalls).toHaveLength(0)
      expect(result).toMatchObject({ outcome: "failed", reason: "category_unavailable" })
      expect(result.completion.reason).toBe("category_unavailable")
      expect(result.completion.model).toBeUndefined()
      expect(result.completion.detail).not.toContain("claude-opus-5-5")
      expect(result.completion.detail).toMatch(/attempted:[^;\s(]+\/[^;\s(]+\((provider_not_connected|model_unavailable)\)/)
    })
  })

  describe("#given a designated model and a cheaper cache-warm session model", () => {
    test("#when the fork route is taken #then it runs the designated model, never the session model", async () => {
      // given: the fork is cheap on a small parent; before #12081 it forked onto the session model
      const parent = parentSessionFile()
      const harness = await createRunnerHarness({
        childMode: "commit",
        config: quickPinnedTo(DESIGNATED_MODEL),
        models: [
          { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
          { provider: "openai", id: "gpt-5.6-luna-fast", cost: LUNA },
        ],
        resolveSessionModel: () => ({ provider: "openai", id: "gpt-5.6-luna-fast" }),
        resolveParentContextTokens: () => 5_000,
        resolveParentSessionFile: () => parent,
        resolveParentCacheReusable: () => true,
      })
      roots.push(harness.root)

      // when
      await harness.runner.launch(harness.run)

      // then
      const spawn = harness.spawnCalls[0]
      expect(spawn).toBeDefined()
      expect(spawn?.args).toContain(DESIGNATED_MODEL)
      expect(spawn?.args).not.toContain(SESSION_MODEL)
      expect(harness.spawnCalls.flatMap((call) => call.args)).not.toContain(SESSION_MODEL)
    })
  })

  describe("#given a designated model that is available", () => {
    test("#when a session model is also live #then the launch is the same as without it", async () => {
      // given
      const models = [
        { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
        { provider: "anthropic", id: "claude-opus-5-5", cost: OPUS },
      ]
      const withSession = await createRunnerHarness({
        childMode: "commit",
        config: quickPinnedTo(DESIGNATED_MODEL),
        models,
        resolveSessionModel: () => ({ provider: "anthropic", id: "claude-opus-5-5" }),
        resolveParentContextTokens: () => 156_872,
      })
      roots.push(withSession.root)
      const withoutSession = await createRunnerHarness({
        childMode: "commit",
        config: quickPinnedTo(DESIGNATED_MODEL),
        models,
      })
      roots.push(withoutSession.root)

      // when
      const first = await withSession.runner.launch(withSession.run)
      const second = await withoutSession.runner.launch(withoutSession.run)

      // then
      expect(first.outcome).toBe(second.outcome)
      expect(first.completion.model).toBe(DESIGNATED_MODEL)
      expect(second.completion.model).toBe(DESIGNATED_MODEL)
      expect(withSession.spawnCalls[0]?.args).toContain(DESIGNATED_MODEL)
      expect(withSession.spawnCalls[0]?.fork).toBeUndefined()
      expect(withoutSession.spawnCalls[0]?.fork).toBeUndefined()
    })
  })
})
