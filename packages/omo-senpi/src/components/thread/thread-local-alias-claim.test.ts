import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

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
})
