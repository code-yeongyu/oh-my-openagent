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

describe("an unnamed row is named after the folder its path names, the same name its refusal candidate carries", () => {
  // #14429's rowFolder (path, else project) is the row's cwd; the name a row shows must come from the same folder, so
  // thread_list and a refusal candidate cannot disagree (#14305 follow-up).
  const PREFIX = "0aa9e7d1"
  const rows: readonly (typeof B_ROW)[] = [
    {
      ...B_ROW,
      session_id: "rk-name-a",
      durable_id: `${PREFIX}-0000-4000-8000-000000000001`,
      title: "",
      project: "renamed-tooling",
      path: "/srv/runs/legacy-tooling",
    },
    {
      ...B_ROW,
      session_id: "rk-name-b",
      durable_id: `${PREFIX}-0000-4000-8000-000000000002`,
      title: "",
      project: "renamed-tooling",
      path: "/srv/runs/attic-thing",
    },
  ]

  test("#given two unnamed rows whose path and project differ #when thread_list runs with all_scope #then each is named after its path's folder", async () => {
    const a = account({ rows })
    const { run } = surface(a.remote)

    const result = await run("thread_list", { all_scope: true })

    expect(result.kind).toBe("ok")
    const listed = (result.kind === "ok" ? result.threads : [])
      .filter((thread) => thread.device === "b")
      .map((thread) => ({ name: thread.name, unnamed: thread.unnamed === true }))
    expect(listed).toEqual([
      { name: "legacy-tooling", unnamed: true },
      { name: "attic-thing", unnamed: true },
    ])
  })

  test("#given the same rows #when a send addresses their shared id prefix #then the ambiguous refusal's candidates carry those same names", async () => {
    const a = account({ rows })
    const { run } = surface(a.remote)

    const result = await run("thread_send", { thread: PREFIX, message: "hi" })

    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const refusal = result.kind === "error" ? result.error : undefined
    const candidates = ((refusal?.candidates ?? refusal?.details?.["candidates"] ?? []) as readonly {
      name: string
    }[])
    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(["attic-thing", "legacy-tooling"])
  })
})
