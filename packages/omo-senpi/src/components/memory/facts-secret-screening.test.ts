import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { FactsFailureStore } from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner } from "./facts-runner"
import { createFactsRecordTool } from "./facts-record-tool"
import { fixture, runnerOptions } from "./facts-runner.test-support"

describe("facts secret screening", () => {
  test("#given a batch whose planned content carries a vendor token #when the apply is refused #then the endpoint parks after one failure with the secret reason", async () => {
    // given: the child's own extraction succeeded, so the refusal must come from the commit gate
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      createRunner: () => ({
        start: async (spec) => {
          const tool = createFactsRecordTool({ extractionPath: join(spec.cwd, "extraction.jsonl") })
          await tool.execute("fact-1", {
            scope: "project",
            text: "the token is ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5",
            date: "2026-08-10",
          })
          return {
            task_id: spec.taskId,
            sessionId: `session-${spec.taskId}`,
            effectiveModel: () => undefined,
            steer: async () => undefined,
            followUp: async () => undefined,
            abort: async () => undefined,
            subscribe: () => () => undefined,
            waitForIdle: async () => ({ status: "completed" as const, finalResponse: "" }),
            lastAssistantText: () => undefined,
            dispose: async () => undefined,
          }
        },
      }),
    }))

    // when
    const result = await runner.launchPending()

    // then: non-retryable - parked after ONE failure, not after five
    expect(result.status).toBe("failed")
    const store = new FactsFailureStore({ identityPaths: identity.paths })
    const state = await store.readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      state: "parked",
      streak: 1,
      lastReason: "secret_like_content",
      nextEligibleAt: null,
    })
    expect(state.entries[0]?.lastDetail ?? "").not.toContain("ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5")
  }, 30_000)
})
