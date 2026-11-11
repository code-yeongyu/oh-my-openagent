import { describe, expect, mock, test } from "bun:test"
import { processMessages } from "./message-processor"

describe("final message retrieval", () => {
  test("#given an operation signal #when retrieving output #then it reaches the SDK transport", async () => {
    // given
    const controller = new AbortController()
    const messages = mock(async () => ({ data: [{ info: { id: "msg_final", role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "result" }] }] }))
    // when
    const output = await processMessages("ses_final_signal", { client: { session: { messages } } } as never, controller.signal)
    // then
    expect(output).toBe("result")
    expect(messages).toHaveBeenCalledWith({ path: { id: "ses_final_signal" }, signal: controller.signal })
  })

  test("#given a transport ignores abort #when its response arrives late #then output is not consumed", async () => {
    // given
    const controller = new AbortController()
    let release!: (value: object) => void
    const response = new Promise<object>((resolve) => { release = resolve })
    const messages = mock(() => response)
    const ctx = { client: { session: { messages } } } as never
    const result = processMessages("ses_late_final", ctx, controller.signal)
    // when
    controller.abort()
    release({ data: [{ info: { id: "msg_late", role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "late result" }] }] })
    // then
    await expect(result).rejects.toThrow()
    expect(await processMessages("ses_late_final", ctx)).toBe("late result")
  })

  test("#given an SDK error envelope #when retrieving final output #then it preserves the actual diagnostic", async () => {
    // given
    const messages = mock(async () => ({ error: { data: { message: "final output unavailable" } } }))
    // when / then
    await expect(processMessages("ses_final_error", { client: { session: { messages } } } as never))
      .rejects.toThrow("final output unavailable")
  })
})
