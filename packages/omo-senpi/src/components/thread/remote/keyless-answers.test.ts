import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ANON = { ...B_ROW, session_id: "rk-anon", durable_id: undefined, title: "anon on b" }
const KEY = "b/rk-anon"
const answered = (result: ThreadToolResult) =>
  result.kind === "ok"
    ? { thread: (result as { thread?: string }).thread, link: (result as { link?: string }).link }
    : result

describe("answers about a session with no durable id name it by its row key (#14305 U7b, review M2 of #14386)", () => {
  test.each([
    ["thread_send", { thread: KEY, message: "hello" }],
    ["thread_set_model", { thread: KEY, model: "opus" }],
    ["thread_read", { thread: KEY }],
  ] as const)(
    "#given %s addressed by b's row key #when it answers #then thread is that key and the link opens it",
    async (tool, args) => {
      const a = account({ rows: [B_ROW, ANON], live: ["rk-on-b", "dur-on-b", "rk-anon"] })
      const result = await surface(a.remote).run(tool, args)
      const shown = answered(result)
      expect(shown).toMatchObject({ thread: KEY })
      if (tool !== "thread_set_model")
        expect("link" in shown && shown.link?.includes(encodeURIComponent(KEY))).toBe(true)
    },
  )

  test("#given b's ended session with no durable id #when a steer is addressed to its row key #then turn_conflict names the row by that key", async () => {
    const ended = { ...ANON, state: "ended" as const }
    const a = account({ rows: [B_ROW, ended], wakeFeature: true })
    const result = await surface(a.remote).run("thread_send", {
      thread: KEY,
      message: "steer",
      delivery: "steer",
      expected_turn_id: "1",
    })
    expect(result).toMatchObject({ kind: "error" })
    expect(JSON.stringify(result)).toContain(KEY)
    expect(JSON.stringify(result)).not.toContain('" on device b')
  })

  test("#given b's ended session with no durable id and no wake on this device #when a send is addressed to its row key #then not_resumable names it by that key in message and details", async () => {
    const ended = { ...ANON, state: "ended" as const }
    const result = await surface(account({ rows: [B_ROW, ended] }).remote).run("thread_send", {
      thread: KEY,
      message: "hi",
    })
    expect(result).toMatchObject({ kind: "error", error: { code: "not_resumable", details: { thread: KEY } } })
    expect(result.kind === "error" ? result.error.message : "").toStartWith(`${KEY} on device b`)
  })
})
