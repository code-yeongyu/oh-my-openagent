import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "./contracts"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

// #14305 U7, review M3 of #14386 (design section 6): one naming rule, thread-address-core `rowName`, on both legs and in
// refusal candidates. A thread with no name shows a fallback marked `unnamed`; a row with no thread id is passed back
// by its row key.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const threads = (listed: ThreadToolResult) => (listed.kind === "ok" && "threads" in listed ? listed.threads : [])

describe("this device's unnamed thread is named as another device's is", () => {
  test("#given a session here with no name #when thread_list runs #then it shows its folder name and says unnamed, while a named one carries no flag", async () => {
    const anon = { sessionId: "route-anon", durableSessionId: "dur-loc-anon", cwd: "/work/anon-folder", name: null }
    const named = { sessionId: "route-local", durableSessionId: "dur-local", cwd: process.cwd(), name: "local peer" }
    const { run } = surface(account().remote, {
      sessions: [
        { ...anon, status: "open" },
        { ...named, status: "open" },
      ],
    })
    const listed = threads(await run("thread_list", { all_scope: true }))
    const here = (id: string) => listed.find((thread) => thread.thread === id)
    expect([here("dur-loc-anon")?.name, here("dur-loc-anon")?.unnamed]).toEqual(["anon-folder", true])
    const local = here("dur-local")
    if (local === undefined) throw new Error("thread_list did not list dur-local")
    expect([local.name, "unnamed" in local]).toEqual(["local peer", false])
  })
})

describe("refusal candidates for rows that publish no thread id", () => {
  test("#given b and c each list a nameless session under the same listing key #when that key is addressed #then each candidate is passed back by its row key and named by rowName", async () => {
    const anon = { ...B_ROW, session_id: "rk-anon", durable_id: undefined, title: "", project: "/work/anon-folder" }
    const a = account({
      devices: [{ device: "c", label: "c-mac", online: true }],
      rows: [anon, { ...anon, device: "c" }],
      live: ["rk-anon"],
    })
    const read = await surface(a.remote).run("thread_read", { thread: "rk-anon" })
    expect(read).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates = (read.kind === "error" ? read.error.details?.["candidates"] : undefined) as
      readonly Record<string, unknown>[] | undefined
    expect(
      (candidates ?? []).map((candidate) => [
        candidate["thread"],
        candidate["address"],
        candidate["name"],
        candidate["unnamed"],
      ]),
    ).toEqual([
      ["b/rk-anon", "b/rk-anon", "anon-folder", true],
      ["c/rk-anon", "c/rk-anon", "anon-folder", true],
    ])
  })
})
