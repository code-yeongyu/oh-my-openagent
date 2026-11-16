import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// #13104: with no account to hold an account-wide alias, the alias is this device's local name for the thread.
describe("an alias with no account", () => {
  test("#given the alias registry answers sign_in #when thread_create sets an alias #then the thread is created here, named by the alias, and the result says the alias is local only", async () => {
    const a = account({ registryDown: "signed_out" })
    const { run, openSession } = surface(a.remote)
    const result = await run("thread_create", { alias: "about-me" })
    expect(result).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(result.kind === "ok" && "thread" in result ? result.thread.alias : "no thread").toBeUndefined()
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ name: "about-me" })
    expect(a.registryCalls).toEqual(["resolve"])
  })

  // #13112 review LOW: the alias-as-name is trimmed like thread_rename's, so a padded alias never names a thread " x ".
  test("#given the alias registry answers sign_in #when thread_create sets a padded alias #then the thread is named by the trimmed alias", async () => {
    const a = account({ registryDown: "signed_out" })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "  about-me " })).toMatchObject({ kind: "ok", alias_scope: "local" })
    expect(openSession.mock.calls[0]?.[0]?.name).toStrictEqual("about-me")
  })

  test("#given the alias registry answers sign_in #when thread_create sets an alias and a name #then the name is kept and the alias is reported local only", async () => {
    const a = account({ registryDown: "signed_out" })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "about-me", name: "notes" })).toMatchObject({
      kind: "ok",
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ name: "notes" })
  })

  test("#given the alias registry answers sign_in #when the alias matches a thread name here #then it is name_conflict and nothing is created", async () => {
    const a = account({ registryDown: "signed_out" })
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { alias: "Local Peer" })).toMatchObject({
      kind: "error",
      error: { code: "name_conflict" },
    })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given no remote surface #when thread_create sets an alias #then the thread is created here under the alias as its name; a device still needs the account", async () => {
    const { run, openSession } = surface(undefined)
    expect(await run("thread_create", { alias: "about-me" })).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-created-here" },
      alias_scope: "local",
      alias_unavailable: "no_remote",
    })
    expect(openSession.mock.calls[0]?.[0]).toMatchObject({ name: "about-me" })
    expect(await run("thread_create", { alias: "x", device: "b" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable" },
    })
  })

  test("#given the alias registry answers sign_in #when thread_rename sets only an alias #then the thread is renamed to it and the result says the alias is local only", async () => {
    const a = account({ registryDown: "signed_out" })
    const { run, setSessionName } = surface(a.remote)
    expect(await run("thread_rename", { thread: "local peer", alias: "about-me" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-local",
      name: "about-me",
      alias_scope: "local",
      alias_unavailable: "sign_in",
    })
    expect(setSessionName.mock.calls.map((call) => call[1])).toEqual(["about-me"])
  })

  // #13112 review LOW: the remote leg of the alias-as-name rename. With no registry, renameAlias answers no_registry, and
  // the alias is checked against b's own listing (nameRefusal) before b's session is renamed (setName over the relay).
  test("#given no alias registry and a thread on b #when thread_rename sets only an alias #then a name b's other thread holds is name_conflict with nothing sent, and a free alias renames b's session to it as its local name", async () => {
    const a = account({
      noRegistry: true,
      rows: [B_ROW, { ...B_ROW, session_id: "rk-other", durable_id: "dur-other-on-b", title: "other peer" }],
    })
    const { run, setSessionName } = surface(a.remote)
    const renames = () =>
      a.sent
        .filter((entry) => entry.rpc?.["type"] === "set_session_name")
        .map((entry) => [entry.via, entry.device, entry.session, entry.rpc?.["name"]])
    expect(await run("thread_rename", { thread: "dur-on-b", alias: "Other Peer" })).toMatchObject({
      kind: "error",
      error: { code: "name_conflict" },
    })
    expect(renames()).toStrictEqual([])
    expect(await run("thread_rename", { thread: "dur-on-b", alias: "  about-me " })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
      name: "about-me",
      alias_scope: "local",
      alias_unavailable: "no_registry",
    })
    expect(renames()).toStrictEqual([["session", "b", "rk-on-b", "about-me"]])
    expect(setSessionName).not.toHaveBeenCalled()
  })

  test("#given the signed-in registry fails otherwise #when thread_rename sets an alias #then it is host_unavailable and the name is unchanged", async () => {
    const a = account({ registryDown: "refused" })
    const { run, setSessionName } = surface(a.remote)
    expect(await run("thread_rename", { thread: "local peer", alias: "about-me" })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable" },
    })
    expect(setSessionName).not.toHaveBeenCalled()
  })
})
