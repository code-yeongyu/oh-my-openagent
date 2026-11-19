import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { B_ROW, createRemoteThreadFixture, fakeRemoteClient } from "../thread-remote-fixture"
import { createRemoteClient } from "../../remote/client"
import { createLazyRemoteSurface } from "../../remote/port/lazy-remote"
import { closingPorts } from "./testing/closing-ports"

// #13873: every port is closed after each test, so no idle detach timer outlives it.
const sessionsPort = closingPorts()

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// The ended row the #13141 cases compare against the live B_ROW: its own listing key and durable id, so a send that
// reaches the wrong row is visible in the recorded relay calls.
const endedPlanner = (title: string) => ({
  ...B_ROW,
  session_id: "rk-old",
  durable_id: "dur-old",
  path: "/home/b/.omo/agent/sessions/dur-old.jsonl",
  title,
  state: "ended" as const,
})
const PLANNER_LIVE = ["rk-on-b", "dur-on-b", "rk-old", "dur-old"]
// The #13141 contender-floor rows, scored by trigram Dice against "billing migration" (15 trigrams). The live row
// "billing migration postmortem" scores 30/41 = 0.7317 and clears the 0.72 accept floor. The ended row "billing
// migration cutover runbook" scores 30/46 = 0.6522: inside [0.64, 0.72), 0.0795 behind the live row, so it blocks it.
// The ended row "billing migration postmortem draft" scores 30/47 = 0.6383, below the 0.64 contender floor and 0.0934
// behind, so it could not block the live row even if it were ranked.
const endedRow = (title: string, key: string) => ({
  ...B_ROW,
  session_id: `rk-${key}`,
  durable_id: `dur-${key}`,
  path: `/home/b/.omo/agent/sessions/dur-${key}.jsonl`,
  title,
  state: "ended" as const,
})
const MIGRATION_LIVE = { ...B_ROW, title: "billing migration postmortem" }
const CUTOVER_ENDED = endedRow("billing migration cutover runbook", "cutover")
const DRAFT_ENDED = endedRow("billing migration postmortem draft", "postmortem-draft")
const migrationHandoff = { thread: "billing migration", match: "fuzzy", message: "continue", all_scope: true }
type SentCalls = ReturnType<typeof account>["sent"]
const relayCalls = (sent: SentCalls) => sent.map((call) => [call.via, call.device, call.session, call.rpc?.["type"]])
const admits = (sent: SentCalls) =>
  sent.filter((call) => call.rpc?.["type"] === "admit_external_message").map((call) => [call.device, call.session])

describe("#13012 route parity", () => {
  test.each([false, true])(
    "#given a resumable thread on another device #when its name is addressed with all_scope %s #then it resolves like a local resumable name",
    async (all_scope) => {
      const a = account({ rowState: "ended" })
      const { run } = surface(a.remote)
      expect(await run("thread_close", { thread: B_ROW.title, all_scope })).toMatchObject({
        kind: "ok",
        thread: B_ROW.durable_id,
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
        thread: B_ROW.durable_id,
        device: B_ROW.device,
        resolved_by: "fuzzy",
      })
      expect(
        a.sent
          .filter((sent) => sent.rpc?.["type"] === "admit_external_message")
          .map((sent) => [sent.device, sent.session]),
      ).toEqual([[B_ROW.device, B_ROW.session_id]])
    },
  )

  test("#given a unique local fuzzy match and 600 ended remote rows #when fuzzy handoff runs #then ended rows that cannot contend stay out of the cap and it resolves locally", async () => {
    const ended = Array.from({ length: 600 }, (_, i) => ({
      ...B_ROW,
      session_id: `rk-old-${i}`,
      durable_id: `dur-old-${i}`,
      title: `archive ${i}`,
      state: "ended" as const,
    }))
    const a = account({ rows: ended })
    let listings = 0
    const { run } = surface({
      ...a.remote,
      sessions: {
        ...a.remote.sessions,
        sessions: async () => {
          listings += 1
          return ended
        },
        listing: async () => {
          listings += 1
          return { rows: ended, incomplete: [] }
        },
      },
    })
    expect(
      await run("thread_handoff", { thread: "local pee", match: "fuzzy", message: "continue", all_scope: true }),
    ).toMatchObject({
      kind: "ok",
      thread: "dur-local",
      resolved_by: "fuzzy",
    })
    expect(listings).toBe(1)
  })

  test("#given a local near-match and a live remote exact title #when fuzzy handoff runs #then the better remote candidate wins", async () => {
    const a = account({ rows: [{ ...B_ROW, title: "local peer review" }] })
    const { run } = surface(a.remote)
    expect(
      await run("thread_handoff", {
        thread: "local peer review",
        match: "fuzzy",
        message: "continue",
        all_scope: true,
      }),
    ).toMatchObject({
      kind: "ok",
      thread: B_ROW.durable_id,
      device: B_ROW.device,
      resolved_by: "fuzzy",
    })
  })

  test("#given only an ended remote row matches #when fuzzy and exact handoff run #then both reach that resumable row through the same relay calls", async () => {
    const endedRow = { ...B_ROW, title: "release planner", state: "ended" as const }
    const fuzzy = account({ rows: [endedRow] })
    const exact = account({ rows: [endedRow] })
    const byFuzzy = await surface(fuzzy.remote).run("thread_handoff", {
      thread: "release planne",
      match: "fuzzy",
      message: "continue",
      all_scope: true,
    })
    const byExact = await surface(exact.remote).run("thread_handoff", {
      thread: "release planner",
      message: "continue",
      all_scope: true,
    })
    expect(byFuzzy).toMatchObject({
      kind: "ok",
      thread: B_ROW.durable_id,
      device: B_ROW.device,
      resolved_by: "fuzzy",
    })
    expect(byExact).toMatchObject({ kind: "ok", thread: B_ROW.durable_id, device: B_ROW.device })
    const calls = (sent: typeof fuzzy.sent) =>
      sent.map((call) => [call.via, call.device, call.session, call.rpc?.["type"]])
    expect(calls(fuzzy.sent)).toStrictEqual(calls(exact.sent))
    expect(calls(fuzzy.sent).filter((call) => call[3] === "admit_external_message")).toStrictEqual([
      ["session", B_ROW.device, B_ROW.session_id, "admit_external_message"],
    ])
  })

  // The exact path refuses two rows that share a name (ambiguous_target, no live preference), so fuzzy must not pick one of
  // them either: a live row and an ended row that match equally are a tie under the runner-up rule.
  test("#given a live and an ended remote row match equally #when fuzzy handoff runs #then it answers ambiguous_target and sends nothing", async () => {
    const a = account({ rows: [endedPlanner("release planner"), { ...B_ROW, title: "release planner" }] })
    const { run } = surface(a.remote)
    expect(
      await run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope: true }),
    ).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    expect(admits(a.sent)).toStrictEqual([])
  })

  // #13141 review: a live row that clears the accept floor must not beat an ended row that matches better. The query is the
  // ended row's exact name, so the exact path reaches dur-old; fuzzy has to land there too, never on dur-on-b.
  test("#given an ended remote row named exactly as the query and a live near-match #when fuzzy and exact handoff run #then both reach the ended row through the same relay calls", async () => {
    const rows = [endedPlanner("release planner"), { ...B_ROW, title: "release planner notes" }]
    const fuzzy = account({ rows, live: PLANNER_LIVE })
    const exact = account({ rows, live: PLANNER_LIVE })
    const byFuzzy = await surface(fuzzy.remote).run("thread_handoff", {
      thread: "release planner",
      match: "fuzzy",
      message: "continue",
      all_scope: true,
    })
    const byExact = await surface(exact.remote).run("thread_handoff", {
      thread: "release planner",
      message: "continue",
      all_scope: true,
    })
    expect(byFuzzy).toMatchObject({ kind: "ok", thread: "dur-old", device: "b", resolved_by: "fuzzy" })
    expect(byExact).toMatchObject({ kind: "ok", thread: "dur-old", device: "b" })
    expect(relayCalls(fuzzy.sent)).toStrictEqual(relayCalls(exact.sent))
    expect(admits(fuzzy.sent)).toStrictEqual([["b", "rk-old"]])
  })

  // Unequal scores, both directions: the clearly better row wins whether it is live or ended. "release planne" scores
  // 0.960 against "release planner" and 0.774 against "release planner notes" (trigram Dice), a lead of 0.186.
  test.each([
    { better: "ended", ended: "release planner", live: "release planner notes", target: ["dur-old", "rk-old"] },
    { better: "live", ended: "release planner notes", live: "release planner", target: ["dur-on-b", "rk-on-b"] },
  ] as const)(
    "#given the $better remote row matches clearly better #when fuzzy handoff runs #then it sends to that row only",
    async ({ ended, live, target }) => {
      const a = account({ rows: [endedPlanner(ended), { ...B_ROW, title: live }], live: PLANNER_LIVE })
      const { run } = surface(a.remote)
      expect(
        await run("thread_handoff", { thread: "release planne", match: "fuzzy", message: "continue", all_scope: true }),
      ).toMatchObject({ kind: "ok", thread: target[0], device: "b", resolved_by: "fuzzy" })
      expect(admits(a.sent)).toStrictEqual([["b", target[1]]])
    },
  )

  test("#given an ended remote row at 0.6522 and a live row at 0.7317, inside the 0.08 margin #when fuzzy handoff runs #then it answers ambiguous_target and sends nothing", async () => {
    const a = account({ rows: [CUTOVER_ENDED, MIGRATION_LIVE] })
    expect(await surface(a.remote).run("thread_handoff", migrationHandoff)).toMatchObject({
      kind: "error",
      error: { code: "ambiguous_target" },
    })
    expect(relayCalls(a.sent)).toStrictEqual([])
  })

  test("#given an ended remote row at 0.6383, below the 0.64 contender floor, and a live row at 0.7317 #when fuzzy handoff runs #then the live row resolves and only it is sent to", async () => {
    const a = account({ rows: [DRAFT_ENDED, MIGRATION_LIVE] })
    expect(await surface(a.remote).run("thread_handoff", migrationHandoff)).toMatchObject({
      kind: "ok",
      thread: B_ROW.durable_id,
      device: B_ROW.device,
      resolved_by: "fuzzy",
    })
    expect(admits(a.sent)).toStrictEqual([[B_ROW.device, B_ROW.session_id]])
  })

  test("#given an ambiguous fuzzy handoff that also has an ended row below the 0.64 floor #when it answers ambiguous_target #then the candidates list the ranked rows and leave that ended row out", async () => {
    const a = account({ rows: [CUTOVER_ENDED, DRAFT_ENDED, MIGRATION_LIVE] })
    const result = await surface(a.remote).run("thread_handoff", migrationHandoff)
    expect(result).toMatchObject({ kind: "error", error: { code: "ambiguous_target" } })
    const candidates =
      (result as { error: { details?: { candidates?: readonly { thread: string; device?: string }[] } } }).error.details
        ?.candidates ?? []
    expect(candidates.map((candidate) => [candidate.thread, candidate.device])).toStrictEqual([
      ["dur-local", "here"],
      ["dur-cutover", "b"],
      [B_ROW.durable_id, "b"],
    ])
    expect(relayCalls(a.sent)).toStrictEqual([])
  })

  test("#given a local thread named exactly as the query and a live remote near-match #when fuzzy and exact handoff run #then both deliver locally and send nothing over the relay", async () => {
    const rows = [{ ...B_ROW, title: "local peer notes" }]
    const fuzzy = account({ rows })
    const exact = account({ rows })
    const byFuzzy = await surface(fuzzy.remote).run("thread_handoff", {
      thread: "local peer",
      match: "fuzzy",
      message: "continue",
      all_scope: true,
    })
    const byExact = await surface(exact.remote).run("thread_handoff", {
      thread: "local peer",
      message: "continue",
      all_scope: true,
    })
    expect(byFuzzy).toMatchObject({ kind: "ok", thread: "dur-local", resolved_by: "fuzzy" })
    expect(byExact).toMatchObject({ kind: "ok", thread: "dur-local" })
    expect(admits(fuzzy.sent)).toStrictEqual([])
    expect(admits(exact.sent)).toStrictEqual([])
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
      client: fakeRemoteClient({
        state: () => "connected",
        here: "here",
        devices: () => [],
        devicesFail: {
          kind: "error",
          code: "host_unavailable",
          message: "device lookup failed",
          next_action: "Retry.",
        },
      }),
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
        sender: { kind: "session", id: "caller" },
        loadRuntime: async () => ({
          // A state dir with no device service endpoint in it: the client finds the service absent without connecting.
          remoteClient: (version, sender) =>
            createRemoteClient(sender, {
              version,
              stateDir: join(tmpdir(), `omo-absent-device-service-${process.pid}`),
            }),
          remoteSessionsPort: () =>
            sessionsPort({
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
      // The client reads the service state and finds no service, so the session port never opens a connection.
      expect(connects).toBe(0)
    },
  )

  test("#given a signed-in device whose service endpoint is briefly gone (an update swap, #14172) #when a durable id is sent to #then host_unavailable, never not_found", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-restarting-device-service-"))
    try {
      // The adopted identity outlives the service process, and the new process holds the state before its per-boot socket is up.
      writeFileSync(join(stateDir, "device-identity.json"), "{}")
      writeFileSync(join(stateDir, "owner.info"), JSON.stringify({ pid: process.pid, since_ms: 0, owner: "service" }))
      let connects = 0
      const remote = createLazyRemoteSurface({
        version: "0.0.0",
        sender: { kind: "session", id: "caller" },
        loadRuntime: async () => ({
          remoteClient: (version, sender) => createRemoteClient(sender, { version, stateDir }),
          remoteSessionsPort: () =>
            sessionsPort({
              version: "0.0.0",
              connect: async () => {
                connects += 1
                throw Object.assign(new Error("device service endpoint is absent"), { code: "ENOENT" })
              },
            }),
        }),
      })
      expect(
        await surface(remote).run("thread_send", { thread: B_ROW.durable_id ?? "", message: "continue" }),
      ).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { state: "unreachable" } },
      })
      expect(connects).toBe(0)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  // #14172: b answered the first round (thread_list showed its thread) and missed the next; the account listing's rounds.
  const missedSecondRound = () => {
    const a = account()
    let round = 0
    const remote = {
      ...a.remote,
      sessions: {
        ...a.remote.sessions,
        listing: async () =>
          ++round === 1 ? { rows: [B_ROW], incomplete: [] } : { rows: [], incomplete: [B_ROW.device] },
      },
    }
    return { a, run: surface(remote).run }
  }

  test("#given a thread listed on b, then a round b missed (#14172) #when it is sent to by durable id #then host_unavailable names b, never not_found", async () => {
    const { a, run } = missedSecondRound()
    expect(await run("thread_list", {})).toMatchObject({ kind: "ok" })
    expect(await run("thread_send", { thread: B_ROW.durable_id ?? "", message: "continue" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "listing_incomplete", devices: [B_ROW.device] } },
    })
    expect(admits(a.sent)).toEqual([])
  })

  test.each([
    ["a name no device ever listed (a typo)", "relase planer"],
    ["a durable id no device ever listed", "0195f0c2-1a2b-7c3d-8e4f-0000000000ff"],
  ])(
    "#given b missed this round #when %s is sent to #then it stays not_found, since nothing ties it to b",
    async (_case, thread) => {
      const { a, run } = missedSecondRound()
      expect(await run("thread_list", {})).toMatchObject({ kind: "ok" })
      expect(await run("thread_send", { thread, message: "continue" })).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(admits(a.sent)).toEqual([])
    },
  )

  test("#given another device missed this listing round #when a thread on a listed device is sent to #then it still delivers there", async () => {
    const a = account({ incomplete: ["c"] })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: B_ROW.durable_id ?? "", message: "continue" })).toMatchObject({
      kind: "ok",
      device: B_ROW.device,
    })
    expect(admits(a.sent)).toEqual([[B_ROW.device, B_ROW.session_id]])
  })

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
          listing: async () => {
            listings += 1
            return { rows: [B_ROW], incomplete: [] }
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
        // The send-side book reads the round (`listing`), the rename its device's rows (`sessions`): one listing count.
        sessions: async () => {
          if (++listings === 2) throw new Error("rename listing failed")
          return [B_ROW]
        },
        listing: async () => {
          if (++listings === 2) throw new Error("rename listing failed")
          return { rows: [B_ROW], incomplete: [] }
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
      thread: B_ROW.durable_id,
      name: "local peer",
      device: B_ROW.device,
    })
    expect(a.sent.map((sent) => sent.rpc?.["type"])).toEqual(["set_session_name"])
  })
})
