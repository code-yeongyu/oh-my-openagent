import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
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

describe("reflection and dream spawn contract", () => {
  for (const dream of [false, true]) {
    test(`#given the cheap-cache session model from the fork-winning regression #when ${dream ? "dream" : "reflection"} launches #then it stays isolated on the quick candidate`, async () => {
      // given
      const harness = await createRunnerHarness({
        childMode: "commit",
        dream,
        config: { categories: { quick: { model: "kimi/kimi-for-coding-highspeed" } } },
        models: [
          { provider: "kimi", id: "kimi-for-coding-highspeed", cost: KIMI },
          { provider: "openai", id: "gpt-5.6-luna-fast", cost: LUNA },
        ],
        resolveSessionModel: () => ({ provider: "openai", id: "gpt-5.6-luna-fast" }),
      })
      roots.push(harness.root)

      // when
      const result = await harness.runner.launch(harness.run)

      // then
      expect(result.outcome).toBe("merged")
      expect(harness.spawnCalls).toHaveLength(1)
      const spawn = harness.spawnCalls[0]
      if (spawn === undefined) throw new Error("expected reflection spawn")
      expect(spawn.args.slice(1)).toEqual([
        "-p",
        "--system-prompt", spawn.paths.persona,
        "--tools", "bash,edit",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--session-dir", spawn.paths.sessionDir,
        "--model", "kimi/kimi-for-coding-highspeed",
        `@${spawn.paths.prompt}`,
      ])
      expect(spawn.args).not.toContain("--fork")
      expect(spawn.model).toBe("kimi/kimi-for-coding-highspeed")
      expect(spawn.kind).toBe(dream ? "dream" : "reflection")
      expect(spawn.paths.sessionDir).toBe(join(harness.identity.paths.reflection, "runs", harness.run.runId))
      expect(spawn.cwd).toBe(spawn.paths.worktree)
      expect(spawn.cwd).not.toBe(harness.root)
      expect(spawn.env.MEMORY_DIR).toBe(spawn.paths.worktree)
      const transcriptPath = spawn.env.TRANSCRIPT_PATH
      if (transcriptPath === undefined) throw new Error("expected transcript payload path")
      expect(transcriptPath).toBe(join(spawn.paths.sessionDir, "transcript-payload.json"))
      expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toEqual({
        schemaVersion: 1,
        runId: harness.run.runId,
        request: harness.run.request,
      })
    })
  }

  test("#given no registry candidate #when the session model is inherited #then its model and thinking launch without inheriting session context", async () => {
    // given
    const harness = await createRunnerHarness({
      childMode: "commit",
      models: [],
      preflightModels: [{ provider: "openai", id: "gpt-5.6-luna-fast" }],
      resolveSessionModel: () => ({ provider: "openai", id: "gpt-5.6-luna-fast", thinking: "low" }),
    })
    roots.push(harness.root)

    // when
    const result = await harness.runner.launch(harness.run)

    // then
    expect(result.outcome).toBe("merged")
    const spawn = harness.spawnCalls[0]
    if (spawn === undefined) throw new Error("expected inherited-model spawn")
    expect(spawn.model).toBe("openai/gpt-5.6-luna-fast")
    expect(spawn.thinking).toBe("low")
    expect(spawn.args).not.toContain("--fork")
    expect(spawn.args).toContain("--system-prompt")
    expect(spawn.args).toContain("--no-extensions")
    expect(spawn.cwd).toBe(spawn.paths.worktree)
  })
})
