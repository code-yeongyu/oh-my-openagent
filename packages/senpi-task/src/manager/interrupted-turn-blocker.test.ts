import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, tempProject } from "./__fixtures__/manager-fakes"
import { sessionTailContinuationBlocker } from "./interrupted-turn"

// senpi#3266: the tail classifier behind the awaiting-input flag. It answers WHY a re-joined idle
// session cannot continue on its own - its last turn was aborted, or it never answered at all.

afterEach(cleanupProjects)

function transcript(project: string, entries: readonly unknown[]): string {
  const path = join(project, "session.jsonl")
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
  return path
}

const ABORTED_TURN = [
  { type: "message", message: { role: "user", content: "do the work" } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "aborted" } },
]

describe("sessionTailContinuationBlocker (senpi#3266)", () => {
  test("#given a tail ending on an aborted assistant row #then the blocker is the aborted turn", async () => {
    // given
    const path = transcript(tempProject(), ABORTED_TURN)

    // when / then
    await expect(sessionTailContinuationBlocker(path)).resolves.toBe("aborted")
  })

  test("#given a tail ending on an unanswered user prompt #then the blocker is the unfinished turn", async () => {
    // given
    const path = transcript(tempProject(), [
      { type: "message", message: { role: "user", content: "do the work" } },
    ])

    // when / then
    await expect(sessionTailContinuationBlocker(path)).resolves.toBe("unfinished")
  })

  test("#given a tail ending on a tool result mid-turn #then the blocker is the unfinished turn", async () => {
    // given
    const path = transcript(tempProject(), [
      { type: "message", message: { role: "user", content: "do the work" } },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "eval", arguments: {} }], stopReason: "toolUse" } },
      { type: "message", message: { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "partial" }] } },
    ])

    // when / then
    await expect(sessionTailContinuationBlocker(path)).resolves.toBe("unfinished")
  })

  test("#given a tail whose turn completed #then there is no blocker", async () => {
    // given
    const path = transcript(tempProject(), [
      { type: "message", message: { role: "user", content: "do the work" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } },
    ])

    // when / then
    await expect(sessionTailContinuationBlocker(path)).resolves.toBeUndefined()
  })

  test("#given an aborted turn followed by extension bookkeeping rows #then the blocker is still the aborted turn", async () => {
    // given - the hooks' stop state and rules scan a host appends are not conversation
    const path = transcript(tempProject(), [
      ...ABORTED_TURN,
      { type: "custom", customType: "senpi.hooks.stop-state", data: {} },
      { type: "custom", customType: "pi-rules.scan", data: {} },
    ])

    // when / then
    await expect(sessionTailContinuationBlocker(path)).resolves.toBe("aborted")
  })

  test("#given a missing transcript #then there is no blocker to read", async () => {
    // given / when / then
    await expect(sessionTailContinuationBlocker(join(tempProject(), "missing.jsonl"))).resolves.toBeUndefined()
  })
})
