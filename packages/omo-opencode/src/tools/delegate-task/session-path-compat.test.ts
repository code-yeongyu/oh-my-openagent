import { describe, expect, mock, test } from "bun:test"

import { callWithSessionPathCompatibility } from "../../shared/session-path-compat"

describe("delegate-task session path compatibility", () => {
  test("#given session.messages rejects object paths #when delegate polling fetches messages #then it retries with string path", async () => {
    // given
    const calls: Array<{ path: { id: string } | string }> = []
    const messages = mock(async (input: { path: { id: string } | string }) => {
      calls.push(input)
      if (typeof input.path !== "string") {
        throw new TypeError('The "path" property must be of type string, got object')
      }
      return { data: [] }
    })

    // when
    const result = await callWithSessionPathCompatibility(messages, {
      path: { id: "ses_delegate_task" },
    })

    // then
    expect(result).toEqual({ data: [] })
    expect(calls.map((call) => call.path)).toEqual([
      { id: "ses_delegate_task" },
      "ses_delegate_task",
    ])
  })
})
