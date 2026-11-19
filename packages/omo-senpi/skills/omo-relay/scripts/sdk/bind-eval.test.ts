import { describe, expect, test } from "bun:test"
import { fleetFromEnv, RelayBindError, threadPortFromTools, type EvalThreadTools } from "./index.ts"

function tools(answers: {
  readonly list?: unknown
  readonly read?: unknown
  readonly send?: unknown
}): EvalThreadTools & {
  readonly calls: unknown[]
} {
  const calls: unknown[] = []
  const reply = (value: unknown) => ({ text: typeof value === "string" ? value : JSON.stringify(value) })
  return {
    calls,
    thread_list: async (args) => {
      calls.push(["list", args])
      return reply(answers.list)
    },
    thread_read: async (args) => {
      calls.push(["read", args])
      return reply(answers.read)
    },
    thread_send: async (args) => {
      calls.push(["send", args])
      return reply(answers.send)
    },
  }
}

describe("threadPortFromTools", () => {
  test("#given a list answer #when listed #then rows keep thread, name and machine and the call passes options through", async () => {
    // given
    const fake = tools({
      list: { kind: "ok", threads: [{ thread: "t-1", name: "one", machine: "device-b", link: "x" }], scope: "all" },
    })

    // when
    const answer = await threadPortFromTools(fake).list({ all_scope: true })

    // then
    expect(answer.kind === "ok" ? answer.threads : []).toEqual([{ thread: "t-1", name: "one", machine: "device-b" }])
    expect(fake.calls).toEqual([["list", { all_scope: true }]])
  })

  test("#given a tool error #when sent #then the port answers that error unchanged", async () => {
    // given
    const error = { code: "not_found", message: "no thread", next_action: "call thread_list" }

    // when
    const answer = await threadPortFromTools(tools({ send: { kind: "error", error } })).send("t-x", "hi", {
      all_scope: true,
    })

    // then
    expect(answer).toEqual({ kind: "error", error })
  })

  test("#given text that is not JSON #when read #then the answer is unreadable_result, not a throw", async () => {
    // when
    const answer = await threadPortFromTools(tools({ read: "not json" })).read("t-1")

    // then
    expect(answer.kind === "error" ? answer.error.code : undefined).toBe("unreadable_result")
  })
})

describe("fleetFromEnv", () => {
  test("#given no SDK root in the environment #when bound #then it throws RelayBindError no_sdk_root", async () => {
    // when
    const bound = fleetFromEnv({})

    // then
    await expect(bound).rejects.toBeInstanceOf(RelayBindError)
    await expect(bound).rejects.toMatchObject({ code: "no_sdk_root" })
  })
})
