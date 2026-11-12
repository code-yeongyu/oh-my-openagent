import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// b's engine names the thread it creates by this durable id; b's relay connector lists it under the relay key rk-b-9.
const CREATED_ON_B = "0195f0c2-1a2b-7c3d-8e4f-0000000000c9"
const onB = (listed: boolean) =>
  account({
    claimDown: "signed_out",
    openData: { sessionId: "rpc-9", state: { durableSessionId: CREATED_ON_B } },
    relayKeys: new Map([[CREATED_ON_B, "rk-b-9"]]),
    rows: listed ? [B_ROW, { ...B_ROW, session_id: "rk-b-9", durable_id: CREATED_ON_B, title: "new on b" }] : [B_ROW],
    live: [B_ROW.session_id, "rk-b-9"],
  })

// Follows #13112: the token expires between resolve and claim, after the thread exists; the alias becomes its local name.
describe("an alias whose claim asks for a sign-in", () => {
  test("#given resolve answers alias_not_found and claim answers sign_in #when thread_create sets an alias #then the created thread is named by the alias and the result says the alias is local only", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, openSession, setSessionName } = surface(a.remote)
    const result = await run("thread_create", { alias: "about-me" })
    expect(result).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(result.kind === "ok" && "thread" in result ? result.thread.alias : "no thread").toBeUndefined()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(setSessionName.mock.calls.map((call) => [call[0], call[1]])).toEqual([["route-created", "about-me"]])
    expect(a.registryCalls).toEqual(["resolve", "claim"])
  })

  test("#given claim answers sign_in #when thread_create sets a padded alias #then the created thread is named by the trimmed alias", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    const result = await run("thread_create", { alias: " about-me  " })
    expect(result).toMatchObject({ kind: "ok", alias_scope: "local", thread: { name: "about-me" } })
    expect(setSessionName.mock.calls.map((call) => [call[0], call[1]])).toStrictEqual([["route-created", "about-me"]])
  })

  test("#given claim answers sign_in #when thread_create sets an alias and a name #then the name is kept and the alias is reported local only", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, openSession, setSessionName } = surface(a.remote)
    expect(await run("thread_create", { alias: "about-me", name: "notes" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ name: "notes" })
    expect(setSessionName).not.toHaveBeenCalled()
  })

  test("#given claim answers sign_in #when the alias matches another thread's name here #then the thread is returned unnamed with local_name_unavailable name_conflict", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    expect(await run("thread_create", { alias: "Local Peer" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
      local_name_unavailable: "name_conflict",
    })
    expect(setSessionName).not.toHaveBeenCalled()
  })

  test("#given claim fails for another reason #when thread_create sets an alias #then it stays host_unavailable naming the created thread", async () => {
    const a = account({ claimDown: "refused" })
    const { run, setSessionName } = surface(a.remote)
    expect(await run("thread_create", { alias: "about-me" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "network", thread_id: "dur-created-here" } },
    })
    expect(setSessionName).not.toHaveBeenCalled()
  })

  test("#given aliasesOf answers and claim answers sign_in #when thread_rename sets only an alias #then the thread is renamed to it and the result says the alias is local only", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    expect(await run("thread_rename", { thread: "local peer", alias: "about-me" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-local",
      name: "about-me",
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(setSessionName.mock.calls.map((call) => call[1])).toEqual(["about-me"])
    expect(a.registryCalls).toEqual(["resolve", "aliasesOf", "claim"])
  })

  // #13179 review LOW: the claim asks for a sign-in after b created the thread, so b's session is renamed over the relay.
  test("#given claim answers sign_in and b's listing has the new thread #when thread_create sets an alias on device b #then b's session is renamed to the alias once over the relay and the result says the alias is local only", async () => {
    const a = onB(true)
    const { run, setSessionName } = surface(a.remote)
    const renames = () =>
      a.sent
        .filter((entry) => entry.rpc?.["type"] === "set_session_name")
        .map((entry) => [entry.via, entry.device, entry.session, entry.rpc?.["name"]])
    expect(await run("thread_create", { device: "b", alias: "about-me" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: CREATED_ON_B, device: "b", name: "about-me" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(renames()).toStrictEqual([["session", "b", "rk-b-9", "about-me"]])
    expect(setSessionName.mock.calls).toStrictEqual([])
    // The second resolve is the rename locating the created thread by its id, through the one resolver every tool uses.
    expect(a.registryCalls).toStrictEqual(["resolve", "claim", "resolve"])
  })

  test("#given claim answers sign_in and b's listing does not have the new thread yet #when thread_create sets an alias on device b #then the thread is answered unnamed with local_name_unavailable not_found and nothing is renamed", async () => {
    const a = onB(false)
    const { run, setSessionName } = surface(a.remote)
    const result = await run("thread_create", { device: "b", alias: "about-me" })
    expect(result).toMatchObject({
      kind: "ok",
      thread: { thread_id: CREATED_ON_B, device: "b" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
      local_name_unavailable: "not_found",
    })
    expect(result.kind === "ok" && "thread" in result ? result.thread.name : "no thread").not.toBe("about-me")
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_session_name")).toStrictEqual([])
    expect(setSessionName.mock.calls).toStrictEqual([])
  })

  // #13179 review LOW: a rename that fails outright (no typed refusal) must still answer the thread the create made.
  test("#given claim answers sign_in and the rename throws an untyped error #when thread_create sets an alias #then it answers ok naming the created thread with local_name_unavailable host_unavailable", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    // #13283 review LOW: the message the real rpc-host socket client throws (senpi-task socket-client.ts).
    setSessionName.mockImplementation(async () => {
      throw new Error("thread RPC connection closed before the response arrived")
    })
    const result = await run("thread_create", { alias: "about-me" })
    expect(result).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
      local_name_unavailable: "host_unavailable",
      // #13185 review LOW: the untyped error's message is kept, so a rename-path bug is traceable.
      local_name_unavailable_reason: "thread RPC connection closed before the response arrived",
    })
    expect(result.kind === "ok" && "thread" in result ? result.thread.name : "no thread").not.toBe("about-me")
    expect(setSessionName.mock.calls.map((call) => [call[0], call[1]])).toStrictEqual([["route-created", "about-me"]])
  })

  // #13283 review LOW: a thrown non-Error value is kept as its string form.
  test("#given claim answers sign_in and the rename throws a non-Error value #when thread_create sets an alias #then the reason is its string form", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    setSessionName.mockImplementation(async () => {
      throw "socket gone"
    })
    const result = await run("thread_create", { alias: "about-me" })
    expect(result).toMatchObject({
      kind: "ok",
      local_name_unavailable: "host_unavailable",
      local_name_unavailable_reason: "socket gone",
    })
  })

  // #13283 review LOW: a failed RPC can carry a whole host reply frame (live-surface.ts); the reason is capped.
  test("#given the rename fails with a message carrying a large host reply frame #when thread_create sets an alias #then the reason is capped with an ellipsis", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    const frame = `thread RPC request failed: ${JSON.stringify({ success: false, data: "x".repeat(5000) })}`
    setSessionName.mockImplementation(async () => {
      throw new Error(frame)
    })
    const result = await run("thread_create", { alias: "about-me" })
    const reason =
      result.kind === "ok" && "local_name_unavailable_reason" in result
        ? result.local_name_unavailable_reason
        : undefined
    expect(typeof reason).toBe("string")
    expect([...(reason ?? "")].length).toBe(301)
    expect(reason?.startsWith("thread RPC request failed: ")).toBe(true)
    expect(reason?.endsWith("…")).toBe(true)
  })

  // #13284 review LOW: the cap cuts on code points, so an astral character at the cut is kept whole, never split.
  test("#given the rename error has an astral character across the cap #when thread_create sets an alias #then the cut keeps it whole", async () => {
    const a = account({ claimDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    setSessionName.mockImplementation(async () => {
      throw new Error(`${"a".repeat(299)}\u{1F600}${"b".repeat(100)}`)
    })
    const result = await run("thread_create", { alias: "about-me" })
    const reason =
      result.kind === "ok" && "local_name_unavailable_reason" in result
        ? result.local_name_unavailable_reason
        : undefined
    expect(reason).toBe(`${"a".repeat(299)}\u{1F600}…`)
    expect(reason?.isWellFormed()).toBe(true)
  })
})
