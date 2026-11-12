import { afterEach, describe, expect, test } from "bun:test"

import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

describe("#13012 route parity", () => {
  test.each([false, true])(
    "#given a resumable thread on another device #when its name is addressed with all_scope %s #then it resolves like a local resumable name",
    async (all_scope) => {
      const a = account({ rowState: "ended" })
      const { run } = surface(a.remote)
      expect(await run("thread_close", { thread: B_ROW.title, all_scope })).toMatchObject({
        kind: "ok",
        thread_id: B_ROW.durable_id,
        device: B_ROW.device,
        closed: false,
      })
      expect(a.sent).toEqual([])
    },
  )

  test.each([false, true])(
    "#given a uniquely matching remote title #when fuzzy handoff searches with all_scope %s #then it sends to that remote candidate",
    async (all_scope) => {
      const a = account({ rows: [{ ...B_ROW, title: "release planner" }] })
      const { run } = surface(a.remote)
      expect(
        await run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope }),
      ).toMatchObject({
        kind: "ok",
        thread: { thread_id: B_ROW.durable_id, device: B_ROW.device },
        resolved_by: "fuzzy",
      })
      expect(
        a.sent
          .filter((sent) => sent.rpc?.["type"] === "admit_external_message")
          .map((sent) => [sent.device, sent.session]),
      ).toEqual([[B_ROW.device, B_ROW.session_id]])
    },
  )

  test("#given a unique local fuzzy match and 600 ended remote rows #when fuzzy handoff runs #then the ended rows are not compared and it resolves locally", async () => {
    const ended = Array.from({ length: 600 }, (_, i) => ({ ...B_ROW, session_id: `rk-old-${i}`, durable_id: `dur-old-${i}`, title: `archive ${i}`, state: "ended" as const }))
    const a = account({ rows: ended })
    let listings = 0
    const { run } = surface({ ...a.remote, sessions: { ...a.remote.sessions, sessions: async () => { listings += 1; return ended } } })
    expect(await run("thread_handoff", { thread: "local pee", match: "fuzzy", message: "continue", all_scope: true })).toMatchObject({
      kind: "ok", thread: { thread_id: "dur-local" }, resolved_by: "fuzzy",
    })
    expect(listings).toBe(1)
  })

  test("#given a local near-match and a live remote exact title #when fuzzy handoff runs #then the better remote candidate wins", async () => {
    const a = account({ rows: [{ ...B_ROW, title: "local peer review" }] })
    const { run } = surface(a.remote)
    expect(await run("thread_handoff", { thread: "local peer review", match: "fuzzy", message: "continue", all_scope: true })).toMatchObject({
      kind: "ok", thread: { thread_id: B_ROW.durable_id, device: B_ROW.device }, resolved_by: "fuzzy",
    })
  })

  test("#given only an ended remote row matches #when fuzzy and exact handoff run #then both reach that resumable row through the same relay calls", async () => {
    const endedRow = { ...B_ROW, title: "release planner", state: "ended" as const }
    const fuzzy = account({ rows: [endedRow] })
    const exact = account({ rows: [endedRow] })
    const byFuzzy = await surface(fuzzy.remote).run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope: true })
    const byExact = await surface(exact.remote).run("thread_handoff", { thread: "release planner", message: "continue", all_scope: true })
    expect(byFuzzy).toMatchObject({ kind: "ok", thread: { thread_id: B_ROW.durable_id, device: B_ROW.device }, resolved_by: "fuzzy" })
    expect(byExact).toMatchObject({ kind: "ok", thread: { thread_id: B_ROW.durable_id, device: B_ROW.device } })
    const calls = (sent: typeof fuzzy.sent) => sent.map((call) => [call.via, call.device, call.session, call.rpc?.["type"]])
    expect(calls(fuzzy.sent)).toStrictEqual(calls(exact.sent))
    expect(calls(fuzzy.sent).filter((call) => call[3] === "admit_external_message")).toStrictEqual([["session", B_ROW.device, B_ROW.session_id, "admit_external_message"]])
  })

  test("#given a live and an ended remote row match equally #when fuzzy handoff runs #then the live row wins", async () => {
    const liveRow = { ...B_ROW, title: "release planner" }
    const endedRow = { ...B_ROW, session_id: "rk-old", durable_id: "dur-old", path: "/home/b/.omo/agent/sessions/dur-old.jsonl", title: "release planner", state: "ended" as const }
    const a = account({ rows: [endedRow, liveRow] })
    const { run } = surface(a.remote)
    expect(await run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope: true })).toMatchObject({
      kind: "ok", thread: { thread_id: B_ROW.durable_id, device: B_ROW.device }, resolved_by: "fuzzy",
    })
    expect(a.sent.filter((sent) => sent.rpc?.["type"] === "admit_external_message").map((sent) => [sent.device, sent.session])).toStrictEqual([[B_ROW.device, B_ROW.session_id]])
  })

  test("#given the account session listing fails #when a remote address is resolved #then its typed transport error survives the resolver", async () => {
    const a = account({ failSessionsList: true })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: B_ROW.durable_id })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given a connected relay's device lookup fails #when a remote name is resolved #then it reports typed unavailability", async () => {
    const a = account()
    const { run } = surface({
      ...a.remote,
      sessions: {
        ...a.remote.sessions,
        thisDevice: async () => {
          throw new Error("device lookup failed")
        },
      },
    })
    expect(await run("thread_read", { thread: B_ROW.title })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "device lookup failed" } },
    })
    expect(a.sent).toEqual([])
  })

  test.each(["thread_read", "thread_send"] as const)(
    "#given no device service with the production lazy remote wired #when %s misses a local name #then it stays not_found",
    async (tool) => {
      let connects = 0
      const remote = createLazyRemoteSurface({
        version: "0.0.0",
        loadRuntime: async () => ({
          createDeviceServiceSessions: () =>
            createDeviceServiceSessions({
              version: "0.0.0",
              connect: async () => {
                connects += 1
                throw Object.assign(new Error("device service endpoint is absent"), { code: "ENOENT" })
              },
            }),
        }),
      })
      expect(await surface(remote).run(tool, { thread: "local peeer", message: "continue" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(connects).toBe(1)
    },
  )

  test.each(["signed_out", "disabled"])(
    "#given remote sessions are %s #when a local name misses #then lookup stays local instead of requiring remote setup",
    async (plan) => {
      const a = account({ plan })
      let listings = 0
      const { run } = surface({
        ...a.remote,
        sessions: {
          ...a.remote.sessions,
          sessions: async () => {
            listings += 1
            return [B_ROW]
          },
        },
      })
      for (const tool of ["thread_read", "thread_send"] as const) {
        expect(await run(tool, { thread: "local peeer", message: "continue" })).toMatchObject({
          kind: "error",
          error: { code: "not_found" },
        })
      }
      expect(listings).toBe(0)
      expect(a.sent).toEqual([])
    },
  )

  test.each([
    "offline",
    "connecting",
    "activation_pending",
    "keychain_locked",
    "authorization_stale",
    "service_degraded",
    "update_required",
  ])(
    "#given a configured relay reports %s #when a remote name is resolved #then the failure stays typed host_unavailable",
    async (plan) => {
      const a = account({ plan })
      expect(await surface(a.remote).run("thread_read", { thread: B_ROW.title })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { state: plan } },
      })
      expect(a.sent).toEqual([])
    },
  )

  test.each(["not_configured", "sign_in_required"])(
    "#given remote sessions are %s #when a local name misses #then lookup stays local (the relay is not set up)",
    async (plan) => {
      const a = account({ plan })
      expect(await surface(a.remote).run("thread_read", { thread: "local peeer" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(a.sent).toEqual([])
    },
  )

  test("#given the target device's rename listing fails after resolution #when an alias and name are requested #then it returns typed host_unavailable before either mutation", async () => {
    const a = account()
    let listings = 0
    const { run } = surface({
      ...a.remote,
      sessions: {
        ...a.remote.sessions,
        sessions: async () => {
          if (++listings === 2) throw new Error("rename listing failed")
          return [B_ROW]
        },
      },
    })
    expect(
      await run("thread_rename", { thread: B_ROW.durable_id, name: "release planner", alias: "kept-free" }),
    ).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: B_ROW.device, reason: "rename listing failed" } },
    })
    expect(listings).toBe(2)
    expect(a.aliases.has("kept-free")).toBe(false)
    expect(a.sent).toEqual([])
  })

  test("#given another thread on the target device holds a name #when a remote rename also claims an alias #then the collision refuses before either mutation", async () => {
    const a = account({
      rows: [
        B_ROW,
        { ...B_ROW, session_id: "rk-other", durable_id: "dur-other", title: "Release Planner", state: "ended" },
      ],
    })
    const { run } = surface(a.remote)
    expect(
      await run("thread_rename", { thread: B_ROW.durable_id, name: "release  planner", alias: "kept-free" }),
    ).toMatchObject({
      kind: "error",
      error: { code: "name_conflict" },
    })
    expect(a.aliases.has("kept-free")).toBe(false)
    expect(a.sent).toEqual([])
  })

  test("#given only this device holds a name #when another device's thread takes it #then that device's conflict set permits the rename", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_rename", { thread: B_ROW.durable_id, name: "local peer" })).toMatchObject({
      kind: "ok",
      thread_id: B_ROW.durable_id,
      name: "local peer",
      device: B_ROW.device,
    })
    expect(a.sent.map((sent) => sent.rpc?.["type"])).toEqual(["set_session_name"])
  })
})
