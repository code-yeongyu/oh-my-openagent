import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteSessionRow } from "./ports"

// #13304: text that another device sent is printed with control, format and separator characters escaped, at OUR print
// sites; the data stays as received, so matching is unchanged. One row per thread tool output that can print text from
// another device. A NEW thread tool that prints a remote field adds its row here.
const PAYLOAD = "p\u202Eq\nr\u001b[31ms\u200Dt"
const RAW = /[\u202E\n\u001b\u200D]/u
// An address may carry format characters but never control characters (addressing refuses those), so the tests that
// address a thread by its title use a title with format characters only.
const ADDRESSABLE = "p\u202Eq r\u200Dt"
const ESCAPED = String.raw`\u202e`

const poisoned = (device: string, key: string, durable: string, title = PAYLOAD): RemoteSessionRow => ({
  ...B_ROW,
  device,
  session_id: key,
  durable_id: durable,
  title,
  project: `/w/${PAYLOAD}`,
})

const clean = (texts: readonly string[]) => {
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) expect(RAW.test(text)).toBe(false)
  expect(texts.some((text) => text.includes(ESCAPED))).toBe(true)
}
const errorOf = (result: ThreadToolResult) =>
  (result as { error?: { message?: string; details?: Record<string, unknown> } }).error ?? {}

describe("text from another device in the thread tools' output (#13304)", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  test.each([
    {
      tool: "thread_list: another device's rows (name, cwd, link)",
      rows: [poisoned("b", "rk-on-b", "dur-on-b")],
      run: (run: (n: never, a: unknown) => Promise<ThreadToolResult>) =>
        run("thread_list" as never, { all_scope: true }),
      texts: (result: ThreadToolResult) =>
        ((result as { threads?: readonly Record<string, unknown>[] }).threads ?? [])
          .filter((thread) => thread["device"] === "b")
          .flatMap((thread) => [thread["name"], thread["cwd"], thread["link"]].map(String)),
    },
    {
      tool: "thread_read: a thread on another device (link)",
      rows: [poisoned("b", "rk-on-b", "dur-on-b")],
      run: (run: (n: never, a: unknown) => Promise<ThreadToolResult>) =>
        run("thread_read" as never, { thread: "dur-on-b" }),
      texts: (result: ThreadToolResult) => [String((result as { link?: unknown }).link)],
    },
    {
      tool: "thread_send: the receipt of a send to another device (link)",
      rows: [poisoned("b", "rk-on-b", "dur-on-b")],
      run: (run: (n: never, a: unknown) => Promise<ThreadToolResult>) =>
        run("thread_send" as never, { thread: "dur-on-b", message: "hi" }),
      texts: (result: ThreadToolResult) => [String((result as { link?: unknown }).link)],
    },
    {
      tool: "thread_handoff: the receipt names another device's thread (name, cwd, link)",
      rows: [poisoned("b", "rk-on-b", "dur-on-b", ADDRESSABLE)],
      run: (run: (n: never, a: unknown) => Promise<ThreadToolResult>) =>
        run("thread_handoff" as never, { thread: ADDRESSABLE, message: "hi" }),
      texts: (result: ThreadToolResult) => {
        const receipt = result as { name?: unknown; cwd?: unknown; link?: unknown }
        return [receipt.name, receipt.cwd, receipt.link].map(String)
      },
    },
    {
      tool: "thread_send: an ambiguous name quoted in the candidates",
      rows: [poisoned("b", "rk-on-b", "dur-on-b", ADDRESSABLE), poisoned("b", "rk-on-b-2", "dur-on-b-2", ADDRESSABLE)],
      run: (run: (n: never, a: unknown) => Promise<ThreadToolResult>) =>
        run("thread_send" as never, { thread: ADDRESSABLE, message: "hi" }),
      texts: (result: ThreadToolResult) =>
        ((errorOf(result).details?.["candidates"] as readonly Record<string, unknown>[] | undefined) ?? []).map((c) =>
          String(c["name"]),
        ),
    },
  ])("#given $tool carrying the payload #then the output shows it escaped", async ({ rows, run, texts }) => {
    const a = fixture.account({ rows, live: rows.map((row) => row.session_id) })
    const result = await run(fixture.surface(a.remote).run as never)
    clean(texts(result))
  })

  test("#given the engine on another device refuses with free error text #then the failure message and details.reason show it escaped", async () => {
    const a = fixture.account({ refuse: PAYLOAD })
    const result = await fixture.surface(a.remote).run("thread_interrupt", { thread: B_ROW.durable_id ?? "" })
    const error = errorOf(result)
    clean([String(error.message), String(error.details?.["reason"])])
  })

  test("#given an engine on another device that refuses find_session with free text #when its closed thread is reopened #then details.reason shows it escaped (#14179 review L11)", async () => {
    const a = fixture.account({
      rows: [{ ...B_ROW, state: "ended" }],
      sessionFiles: "none",
      findSessionRefuse: `Unknown command: ${PAYLOAD}`,
    })
    const result = await fixture.surface(a.remote).run("thread_create", { thread: "dur-on-b" })
    expect(result).toMatchObject({ kind: "error", error: { code: "unsupported" } })
    clean([String(errorOf(result).details?.["reason"])])
  })

  test("#given a thread on another device whose title carries the payload #when it is addressed by that exact title #then it is found: the data is not escaped", async () => {
    const row = poisoned("b", "rk-on-b", "dur-on-b", ADDRESSABLE)
    const a = fixture.account({ rows: [row], live: [row.session_id] })
    expect(await fixture.surface(a.remote).run("thread_send", { thread: ADDRESSABLE, message: "hi" })).toMatchObject({
      kind: "ok",
      device: "b",
    })
  })
})
