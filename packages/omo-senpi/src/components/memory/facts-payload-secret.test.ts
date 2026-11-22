import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { containsSecretLikeMaterial, type TranscriptEntry } from "@oh-my-opencode/memory-core"
import type { ChildSpec } from "@oh-my-opencode/senpi-task"

import { FactsExtractorRunner } from "./facts-runner"
import { fixture, runnerOptions } from "./facts-runner.test-support"

const NOW = new Date("2026-08-16T12:00:00.000Z")
const SECRET_SPAN = "t o k e n: abcd1234efgh"

function message(messageId: string, text: string): TranscriptEntry {
  return {
    kind: "user",
    text,
    captured_at: "2026-08-16T00:00:00.000Z",
    source_line_id: `${messageId}:user`,
    source_message_id: messageId,
  }
}

// #10116: the commit gate refuses a whole facts batch when any written blob carries a secret-like span, so one queued
// message with such a span parked every endpoint of the batch. The extractor must never see the span in the first place.
describe("facts payload secret-like spans (#10116)", () => {
  test("#given a queued message with a secret-like span #when a facts run launches #then neither the payload file nor the prompt carries the span", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await queue.enqueue({
      identity: identity.id,
      sessionId: "session-1",
      conversationId: "session-1",
      entries: [message("m-1", `please remember ${SECRET_SPAN} for later`)],
    })
    const filePayloads: string[] = []
    const prompts: string[] = []
    const base = runnerOptions(root, identity, queue, "fact", { now: () => NOW })
    const create = base.createRunner
    if (create === undefined) throw new Error("facts test runner must provide an in-process runner")
    const runner = new FactsExtractorRunner({
      ...base,
      createRunner: (options) => {
        const real = create(options)
        return {
          start: async (spec: ChildSpec) => {
            filePayloads.push(await readFile(join(spec.cwd, "facts-payload.json"), "utf8"))
            prompts.push(spec.prompt)
            return real.start(spec)
          },
        }
      },
    })

    // when
    const result = await runner.launchPending()

    // then
    expect(filePayloads).toHaveLength(1)
    expect(filePayloads[0]).toContain("please remember")
    expect(containsSecretLikeMaterial(filePayloads[0] ?? "")).toBe(false)
    expect(containsSecretLikeMaterial(prompts[0] ?? "")).toBe(false)
    expect(result.status).toBe("committed")
  }, 60_000)
})
