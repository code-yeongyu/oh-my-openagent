import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "../teardown.test-support"

import { createRunnerHarness } from "./runner.test-support"

const roots: string[] = []

// Each case launches a real supervisor and child process and performs git work. Match the 60s
// ceiling used by the supervisor suites so loaded Windows CI runners retain the same coverage.
setDefaultTimeout(60_000)

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const LUNA = { input: 0.25, cacheRead: 0.025, output: 2.00 }
const KIMI = { input: 0.60, cacheRead: 0.15, output: 2.50 }
const OPUS = { input: 5.00, cacheRead: 0.50, output: 25.0 }

const PREFIX_BREAKING_FLAGS = [
  "--system-prompt",
  "--tools",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
]

function parentSessionFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "parent-session-"))
  roots.push(dir)
  const file = join(dir, "parent.jsonl")
  writeFileSync(file, `${JSON.stringify({ type: "session", id: "parent-1", timestamp: new Date().toISOString(), cwd: "/parent/project" })}\n`, "utf8")
  return file
}

describe("reflection fork-mode spawn", () => {
  describe("#given a cheap-cache session model and a small parent context", () => {
    test("#when launched #then the spawn forks the parent session and never breaks the prefix", async () => {
      // given
      const parent = parentSessionFile()
      const harness = await createRunnerHarness({
        childMode: "commit",
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
      expect(spawn?.fork).toEqual({ parentSessionFile: parent })
      expect(spawn?.args).toContain("--fork")
      expect(spawn?.args).toContain(parent)
      for (const flag of PREFIX_BREAKING_FLAGS) {
        expect(spawn?.args).not.toContain(flag)
      }
    })
  })

  describe("#given an expensive session model", () => {
    test("#when launched #then the spawn keeps the sandboxed shape with --system-prompt", async () => {
      // given
      const harness = await createRunnerHarness({
        childMode: "commit",
        models: [
          { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
          { provider: "anthropic", id: "claude-opus-5", cost: OPUS },
        ],
        resolveSessionModel: () => ({ provider: "anthropic", id: "claude-opus-5" }),
        resolveParentContextTokens: () => 156_872,
      })
      roots.push(harness.root)

      // when
      await harness.runner.launch(harness.run)

      // then
      const spawn = harness.spawnCalls[0]
      expect(spawn?.fork).toBeUndefined()
      expect(spawn?.args).toContain("--system-prompt")
      expect(spawn?.args).toContain("--no-extensions")
    })
  })

  describe("#given the parent cache cannot be proven reusable", () => {
    // A cached prefix is only reused inside the provider TTL, and the only honest signal is the
    // session's own usage totals. cacheHit is a price input, not a veto: a miss makes fork costlier
    // but does not forbid it, so the decision only flips where the miss actually costs more.
    test("#when the parent context is large enough that a miss costs more than quick #then it stays sandboxed", async () => {
      // given: a large parent context where full input price on the prefix beats the quick child
      const harness = await createRunnerHarness({
        childMode: "commit",
        models: [
          { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
          { provider: "openai", id: "gpt-5.6-luna-fast", cost: LUNA },
        ],
        resolveSessionModel: () => ({ provider: "openai", id: "gpt-5.6-luna-fast" }),
        resolveParentContextTokens: () => 360_463,
        resolveParentSessionFile: () => parentSessionFile(),
        resolveParentCacheReusable: () => false,
      })
      roots.push(harness.root)

      // when
      await harness.runner.launch(harness.run)

      // then
      const spawn = harness.spawnCalls[0]
      expect(spawn?.fork).toBeUndefined()
      expect(spawn?.args).toContain("--system-prompt")
    })
  })

  describe("#given no parent session file", () => {
    test("#when fork would otherwise win #then it stays sandboxed rather than crashing", async () => {
      // given: fork wins on cost but there is no parent file to fork
      const harness = await createRunnerHarness({
        childMode: "commit",
        models: [
          { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
          { provider: "openai", id: "gpt-5.6-luna-fast", cost: LUNA },
        ],
        resolveSessionModel: () => ({ provider: "openai", id: "gpt-5.6-luna-fast" }),
        resolveParentContextTokens: () => 5_000,
      })
      roots.push(harness.root)

      // when
      await harness.runner.launch(harness.run)

      // then
      const spawn = harness.spawnCalls[0]
      expect(spawn?.fork).toBeUndefined()
      expect(spawn?.args).toContain("--system-prompt")
    })
  })
})
