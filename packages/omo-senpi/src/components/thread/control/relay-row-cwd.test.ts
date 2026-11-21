import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

// #14429: the device service lists a session's working folder as `path` and only the folder's NAME as `project`. A
// reopen answered `cwd: "<folder name>"` (a relative path that reads like the thread's name) whenever the engine's reply
// carried no cwd, and thread_list showed the same name as every remote thread's cwd.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ROW = { ...B_ROW, project: "hcfree-kakao", path: "/srv/runs/hcfree-kakao" }

describe("a thread on another device reports its working folder, not the folder's name", () => {
  test("#given b's engine answers a reopen without a cwd #when thread_create reopens the listed thread #then cwd is the row's working folder", async () => {
    const a = account({ rows: [ROW], openData: { sessionId: "rpc-9", state: { sessionId: "dur-on-b" } } })
    const { run } = surface(a.remote)

    const result = await run("thread_create", { thread: "dur-on-b" })

    expect(result).toMatchObject({ kind: "ok", cwd: "/srv/runs/hcfree-kakao" })
  })

  test("#given b lists the thread #when thread_list runs with all_scope #then its cwd is the row's working folder", async () => {
    const a = account({ rows: [ROW] })
    const { run } = surface(a.remote)

    const result = await run("thread_list", { all_scope: true })

    expect(JSON.stringify(result)).toContain('"cwd":"/srv/runs/hcfree-kakao"')
    expect(JSON.stringify(result)).not.toContain('"cwd":"hcfree-kakao"')
  })

  test("#given b lists the thread #when thread_handoff delivers to it by name #then the receipt's cwd is the row's working folder", async () => {
    const a = account({ rows: [ROW] })
    const { run } = surface(a.remote)

    const result = await run("thread_handoff", { thread: ROW.title, message: "hi" })

    expect(result).toMatchObject({ kind: "ok", cwd: "/srv/runs/hcfree-kakao" })
  })

  test.each(["unknown", ""])(
    "#given b lists the thread's path as %p #when thread_list runs with all_scope #then its cwd falls back to the folder name b listed",
    async (path) => {
      const a = account({ rows: [{ ...ROW, path }] })
      const { run } = surface(a.remote)

      const result = await run("thread_list", { all_scope: true })

      expect(JSON.stringify(result)).toContain('"cwd":"hcfree-kakao"')
    },
  )
})
