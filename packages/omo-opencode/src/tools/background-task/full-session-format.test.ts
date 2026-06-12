import { describe, test, expect, mock } from "bun:test"
import { formatFullSession } from "./full-session-format"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient } from "./clients"

function makeMessage(id: string, role: "user" | "assistant", text: string, time: number) {
  return {
    id,
    info: { role, time },
    parts: [{ type: "text", text }],
  }
}

function makeClient(messages: ReturnType<typeof makeMessage>[]): BackgroundOutputClient {
  return {
    session: {
      messages: mock(async () => ({ data: messages })),
    },
  } as unknown as BackgroundOutputClient
}

function makeTask(): BackgroundTask {
  return {
    id: "bg_test",
    sessionId: "ses_child",
    description: "test task",
    agent: "oracle",
    status: "completed",
  } as BackgroundTask
}

describe("formatFullSession", () => {
  test("#given 5 messages, no limit, default direction #when formatFullSession runs #then start-first chronological order (backward compatible)", async () => {
    const messages = [
      makeMessage("msg_1_user", "user", "USER_PROMPT_HEADER", 1778525000100),
      makeMessage("msg_2_asst", "assistant", "ASST_INTERMEDIATE_1", 1778525000200),
      makeMessage("msg_3_asst", "assistant", "ASST_INTERMEDIATE_2", 1778525000300),
      makeMessage("msg_4_asst", "assistant", "ASST_INTERMEDIATE_3", 1778525000400),
      makeMessage("msg_5_asst", "assistant", "ASST_FINAL_SYNTHESIS", 1778525000500),
    ]
    const client = makeClient(messages)

    const output = await formatFullSession(makeTask(), client, {
      includeThinking: false,
      includeToolResults: false,
    })

    expect(output).toContain("USER_PROMPT_HEADER")
    expect(output).toContain("ASST_FINAL_SYNTHESIS")
    expect(output.indexOf("USER_PROMPT_HEADER")).toBeLessThan(output.indexOf("ASST_FINAL_SYNTHESIS"))
  })

  test("#given messageLimit=2 and default direction #when formatFullSession runs #then the FIRST 2 messages are returned (backward compatible)", async () => {
    const messages = [
      makeMessage("msg_1", "user", "FIRST_USER_PROMPT", 1778525000100),
      makeMessage("msg_2", "assistant", "EARLY_RESPONSE", 1778525000200),
      makeMessage("msg_3", "assistant", "MIDDLE_RESPONSE", 1778525000300),
      makeMessage("msg_4", "assistant", "SECOND_TO_LAST_RESPONSE", 1778525000400),
      makeMessage("msg_5", "assistant", "FINAL_RESPONSE", 1778525000500),
    ]
    const client = makeClient(messages)

    const output = await formatFullSession(makeTask(), client, {
      includeThinking: false,
      includeToolResults: false,
      messageLimit: 2,
    })

    expect(output).toContain("FIRST_USER_PROMPT")
    expect(output).toContain("EARLY_RESPONSE")
    expect(output).not.toContain("SECOND_TO_LAST_RESPONSE")
    expect(output).not.toContain("FINAL_RESPONSE")
  })

  test("#given messageLimit=2 and fromEnd=true #when formatFullSession runs #then the LAST 2 messages are returned (the opt-in fix for 'give me the answer')", async () => {
    const messages = [
      makeMessage("msg_1", "user", "FIRST_USER_PROMPT", 1778525000100),
      makeMessage("msg_2", "assistant", "EARLY_RESPONSE", 1778525000200),
      makeMessage("msg_3", "assistant", "MIDDLE_RESPONSE", 1778525000300),
      makeMessage("msg_4", "assistant", "SECOND_TO_LAST_RESPONSE", 1778525000400),
      makeMessage("msg_5", "assistant", "FINAL_RESPONSE", 1778525000500),
    ]
    const client = makeClient(messages)

    const output = await formatFullSession(makeTask(), client, {
      includeThinking: false,
      includeToolResults: false,
      messageLimit: 2,
      fromEnd: true,
    })

    expect(output).toContain("SECOND_TO_LAST_RESPONSE")
    expect(output).toContain("FINAL_RESPONSE")
    expect(output).not.toContain("FIRST_USER_PROMPT")
    expect(output).not.toContain("EARLY_RESPONSE")
  })

  test("#given 25 messages with messageLimit=20 and fromEnd=true #when formatFullSession runs #then the LAST 20 are returned and the final synthesis is present", async () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(`msg_${String(i + 1).padStart(2, "0")}`, i === 24 ? "assistant" : "user", `BODY_${i + 1}`, 1778525000000 + (i + 1) * 1000),
    )
    const client = makeClient(messages)

    const output = await formatFullSession(makeTask(), client, {
      includeThinking: false,
      includeToolResults: false,
      fromEnd: true,
      messageLimit: 20,
    })

    expect(output).toContain("BODY_25")
    expect(output).not.toContain("BODY_1\n")
    expect(output).not.toContain("BODY_5\n")
  })

  test("#given sinceMessageId for forward pagination #when formatFullSession runs #then messages AFTER that id are returned", async () => {
    const messages = [
      makeMessage("msg_1", "user", "PROMPT_1", 1778525000100),
      makeMessage("msg_2", "assistant", "RESPONSE_1", 1778525000200),
      makeMessage("msg_3", "user", "PROMPT_2", 1778525000300),
      makeMessage("msg_4", "assistant", "RESPONSE_2", 1778525000400),
      makeMessage("msg_5", "user", "PROMPT_3", 1778525000500),
      makeMessage("msg_6", "assistant", "RESPONSE_3", 1778525000600),
    ]
    const client = makeClient(messages)

    const output = await formatFullSession(makeTask(), client, {
      includeThinking: false,
      includeToolResults: false,
      sinceMessageId: "msg_3",
    })

    expect(output).toContain("RESPONSE_2")
    expect(output).toContain("PROMPT_3")
    expect(output).toContain("RESPONSE_3")
    expect(output).not.toContain("PROMPT_1")
    expect(output).not.toContain("RESPONSE_1")
    expect(output).not.toContain("PROMPT_2")
  })
})
