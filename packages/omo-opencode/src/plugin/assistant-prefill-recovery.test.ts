import { describe, expect, test } from "bun:test"

import { createMessagesTransformHandler } from "./messages-transform"

type TestPart = {
  type: string
  id?: string
  sessionID?: string
  messageID?: string
  callID?: string
  tool?: string
  text?: string
  synthetic?: boolean
  state?: { status?: string; input?: Record<string, unknown>; time?: { start: number; end?: number } }
  metadata?: Record<string, unknown>
}

type TestMessage = {
  info: {
    role: "assistant" | "user"
    id?: string
    sessionID?: string
    agent?: string
    model?: { providerID: string; modelID: string }
    time?: { created: number; completed?: number }
  }
  parts: TestPart[]
}

const RECOVERY_TEXT = "[internal] Continue from the previous assistant state."
const RECOVERY_MARKER = "assistant_prefill_recovery"

function userMessage(input: {
  id: string
  sessionID: string
  providerID: string
  modelID: string
}): TestMessage {
  return {
    info: {
      role: "user",
      id: input.id,
      sessionID: input.sessionID,
      agent: "sisyphus",
      model: { providerID: input.providerID, modelID: input.modelID },
    },
    parts: [{ type: "text", id: `prt_${input.id}`, messageID: input.id, text: "do the work" }],
  }
}

function assistantTextTail(input: { id: string; sessionID: string; completed?: number }): TestMessage {
  return {
    info: {
      role: "assistant",
      id: input.id,
      sessionID: input.sessionID,
      ...(input.completed === undefined ? {} : { time: { created: 1, completed: input.completed } }),
    },
    parts: [{ type: "text", id: `prt_${input.id}`, messageID: input.id, text: "partial answer" }],
  }
}

function assistantToolTail(input: {
  id: string
  sessionID: string
  status: "pending" | "running" | "completed" | "error"
}): TestMessage {
  return {
    info: { role: "assistant", id: input.id, sessionID: input.sessionID },
    parts: [{
      type: "tool",
      id: `prt_${input.id}`,
      messageID: input.id,
      callID: `call_${input.id}`,
      tool: "task_completed",
      state: { status: input.status, input: {}, time: { start: 1, ...(input.status === "running" ? {} : { end: 2 }) } },
    }],
  }
}

async function runTransform(messages: TestMessage[]): Promise<void> {
  const handler = createMessagesTransformHandler({ hooks: {} })
  await handler({} as never, { messages: messages as never })
}

describe("assistant prefill recovery loop-breaker", () => {
  test("#given a complete prior assistant turn ending in a finished tool result #when the next request transforms #then no recovery injection happens", async () => {
    //#given
    // The agent answered and called an explicit completion signal; the tool executed.
    // OpenCode auto-continues the turn, so the payload ends with this assistant tail.
    const messages: TestMessage[] = [
      userMessage({ id: "msg_user_complete", sessionID: "ses_7150_complete", providerID: "opencode", modelID: "claude-opus-4-8" }),
      assistantToolTail({ id: "msg_assistant_complete", sessionID: "ses_7150_complete", status: "completed" }),
    ]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)?.info.role).toBe("assistant")
  })

  test("#given a genuinely truncated assistant state with a dangling running tool call #when messages transform runs #then exactly one marked recovery turn is injected", async () => {
    //#given
    const messages: TestMessage[] = [
      userMessage({ id: "msg_user_truncated", sessionID: "ses_7150_truncated", providerID: "opencode", modelID: "claude-opus-4-8" }),
      assistantToolTail({ id: "msg_assistant_truncated", sessionID: "ses_7150_truncated", status: "running" }),
    ]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.info).toMatchObject({
      role: "user",
      id: "msg_assistant_truncated_prefill_recovery",
      sessionID: "ses_7150_truncated",
    })
    expect(messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: RECOVERY_TEXT,
      synthetic: true,
    })
    expect(messages.at(-1)?.parts[0]?.metadata).toMatchObject({ [RECOVERY_MARKER]: true })
  })

  test("#given an injected continuation that completed its turn #when the follow-up auto-continue request transforms #then no second injection chains onto it", async () => {
    //#given
    const firstRequest: TestMessage[] = [
      userMessage({ id: "msg_user_chain", sessionID: "ses_7150_chain", providerID: "opencode", modelID: "claude-opus-4-8" }),
      assistantTextTail({ id: "msg_assistant_interrupted", sessionID: "ses_7150_chain" }),
    ]
    const handler = createMessagesTransformHandler({ hooks: {} })

    //#when
    await handler({} as never, { messages: firstRequest as never })
    expect(firstRequest).toHaveLength(3)
    // The model answered the injected continuation and finished with a completed tool call;
    // OpenCode issues the next request WITHOUT persisting the synthetic recovery message.
    const secondRequest: TestMessage[] = [
      firstRequest[0]!,
      firstRequest[1]!,
      assistantToolTail({ id: "msg_assistant_after_recovery", sessionID: "ses_7150_chain", status: "completed" }),
    ]
    await handler({} as never, { messages: secondRequest as never })

    //#then
    expect(secondRequest).toHaveLength(3)
    expect(secondRequest.at(-1)?.info.role).toBe("assistant")
  })

  test("#given repeated partial tails within the same user turn #when injections exceed the attempt cap #then further injections stop", async () => {
    //#given
    const handler = createMessagesTransformHandler({ hooks: {} })
    const base: TestMessage[] = [
      userMessage({ id: "msg_user_cap", sessionID: "ses_7150_cap", providerID: "anthropic", modelID: "claude-opus-4-8" }),
    ]

    //#when
    for (let cycle = 0; cycle < 5; cycle += 1) {
      base.push(assistantTextTail({ id: `msg_assistant_cap_${cycle}`, sessionID: "ses_7150_cap" }))
      await handler({} as never, { messages: base as never })
    }

    //#then
    const injections = base.filter((message) => message.info.id?.endsWith("_prefill_recovery"))
    expect(injections.length).toBeLessThanOrEqual(3)
    expect(base.at(-1)?.info.role).toBe("assistant")
  })

  test("#given the last user turn already carries the recovery marker #when messages transform runs #then it never injects on top of its own continuation", async () => {
    //#given
    const markerTurn: TestMessage = {
      info: {
        role: "user",
        id: "msg_marker_turn",
        sessionID: "ses_7150_marker",
        agent: "internal",
        model: { providerID: "opencode", modelID: "claude-opus-4-8" },
      },
      parts: [{
        type: "text",
        id: "prt_marker_turn",
        messageID: "msg_marker_turn",
        text: RECOVERY_TEXT,
        synthetic: true,
        metadata: { [RECOVERY_MARKER]: true },
      }],
    }
    const messages: TestMessage[] = [
      markerTurn,
      assistantTextTail({ id: "msg_assistant_marker", sessionID: "ses_7150_marker" }),
    ]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)?.info.role).toBe("assistant")
  })

  test("#given a compaction continuation followed by a plain finished assistant turn #when messages transform runs #then the completed turn is not recovered again", async () => {
    //#given
    const messages: TestMessage[] = [
      {
        info: { role: "user", id: "msg_compaction_continue", sessionID: "ses_7150_compaction" },
        parts: [{
          type: "text",
          id: "prt_compaction_continue",
          messageID: "msg_compaction_continue",
          text: "[session recovered - continuing previous task]",
          synthetic: true,
          metadata: { compaction_continue: true },
        }],
      },
      assistantTextTail({ id: "msg_assistant_finished", sessionID: "ses_7150_compaction", completed: 2 }),
    ]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)?.info.role).toBe("assistant")
  })

  test("#given a partial prefill stream tail for a gated model #when messages transform runs #then recovery still fires once so genuine resume keeps working", async () => {
    //#given
    const messages: TestMessage[] = [
      userMessage({ id: "msg_user_partial", sessionID: "ses_7150_partial", providerID: "opencode", modelID: "claude-opus-4-8" }),
      assistantTextTail({ id: "msg_assistant_partial", sessionID: "ses_7150_partial" }),
    ]

    //#when
    await runTransform(messages)

    //#then
    expect(messages).toHaveLength(3)
    expect(messages.at(-1)?.parts[0]).toMatchObject({ type: "text", text: RECOVERY_TEXT, synthetic: true })
  })
})
