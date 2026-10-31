import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { creatorAnchor } from "../../memory-core/src/sync/crypto/anchor.ts"
import { appendEntries, emptyChain } from "../../memory-core/src/sync/crypto/chain.ts"
import { createRejectionCounter } from "../../memory-core/src/sync/crypto/rejection.ts"
import { pinTrustAnchor } from "../../memory-core/src/sync/crypto/trust-pin.ts"
import { createWorld, removeWorldStateDirs } from "../../memory-core/src/sync/recovery/testing/world.test-support.ts"
import { createCredentialStore, type CredentialStore, KeychainLockedError, type SecretApi } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})
afterAll(removeWorldStateDirs)

const credential = (deviceId: string, expiresInMs: number, refreshToken = `rt-${deviceId}`): Credentials => ({
  accessToken: `at-${deviceId}-${expiresInMs}`,
  accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  refreshToken,
  device: { id: deviceId, name: `device ${deviceId}` },
  signingPrivateKey: "c2lnbmluZw==",
  sealingPrivateKey: "c2VhbGluZw==",
})

function memoryStore(initial: Credentials | null) {
  let value = initial
  const store: CredentialStore = {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async next => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
  return { store, current: () => value }
}

function run(store: CredentialStore, args: string[], options: { stdin?: string; api?: string; pinDir?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "omo-account-cli-"))
  homes.push(home)
  const pinDir = options.pinDir ?? join(home, "sync-device")
  const out: string[] = []
  const err: string[] = []
  return runAccountVerb(
    {
      api: options.api ?? "http://127.0.0.1:1",
      store,
      home,
      pinDir: () => pinDir,
      readStdin: async () => options.stdin ?? "",
      output: line => out.push(line),
      error: line => err.push(line),
    },
    args,
  ).then(code => ({ code, out: out.map(line => JSON.parse(line) as Record<string, unknown>), err }))
}

function fakeService(answer: (body: Record<string, unknown>) => Response) {
  const refreshTokens: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/v1/session/refresh") return new Response(null, { status: 404 })
      const body = (await req.json()) as Record<string, unknown>
      refreshTokens.push(String(body.refreshToken))
      return answer(body)
    },
  })
  return { api: `http://127.0.0.1:${server.port}`, refreshTokens, stop: () => server.stop(true) }
}

describe("omo account", () => {
  test.each(["{", JSON.stringify({ accessToken: "synthetic-invalid" })])("#given corrupt stored data %s #when forgotten #then deletion needs no credential read", async initial => {
    let value: string | null = initial
    const calls: string[] = []
    const store = createCredentialStore("http://127.0.0.1:1", { platform: "darwin", secrets: {
      get: async () => { calls.push("get"); return value },
      set: async ({ value: next }) => { calls.push("set"); value = next },
      delete: async () => { calls.push("delete"); value = null; return true },
    } })
    const result = await run(store, ["forget"])
    expect({ code: result.code, out: result.out, calls }).toEqual({
      code: ACCOUNT_EXIT.ok, out: [{ forgotten: true }], calls: ["delete"],
    })
    expect(value).toBeNull()
  })

  test.each([false, true])("#given corrupt credentials #when adopt replace is %s #then only explicit replacement recovers", async replace => {
    let value: string | null = "{"
    const calls: string[] = []
    const incoming = credential("dev_recovered", 3_600_000)
    const store = createCredentialStore("http://127.0.0.1:1", { platform: "darwin", secrets: {
      get: async () => { calls.push("get"); return value },
      set: async ({ value: next }) => { calls.push("set"); value = next },
      delete: async () => { calls.push("delete"); value = null; return true },
    } })
    const result = await run(store, replace ? ["adopt", "--replace"] : ["adopt"], { stdin: JSON.stringify(incoming) })
    expect(result.code).toBe(replace ? ACCOUNT_EXIT.ok : ACCOUNT_EXIT.failed)
    expect(calls).toEqual(replace ? ["get", "get", "set"] : ["get"])
    if (replace) {
      expect(JSON.parse(value ?? "null")).toEqual({ ...incoming, credentialGeneration: expect.any(String) })
    } else {
      expect(value).toBe("{")
    }
  })

  test("#given a native read failure #when adopt explicitly replaces #then it does not overwrite an inaccessible item", async () => {
    const calls: string[] = []
    const store = createCredentialStore("http://127.0.0.1:1", { platform: "darwin", secrets: {
      get: async () => { calls.push("get"); throw new Error("synthetic native failure") },
      set: async () => { calls.push("set") },
      delete: async () => { calls.push("delete"); return true },
    } })
    const result = await run(store, ["adopt", "--replace"], { stdin: JSON.stringify(credential("dev_a", 3_600_000)) })
    expect({ code: result.code, out: result.out, calls }).toEqual({
      code: ACCOUNT_EXIT.storeUnavailable, out: [{ error: "store-unavailable" }], calls: ["get"],
    })
  })

  test.each(["dev_a", "dev_b"])("#given readable %s #when forgetting dev_a #then compare and delete targets only that device", async device => {
    const held = credential(device, 3_600_000)
    const { store, current } = memoryStore(held)
    const result = await run(store, ["forget", "--device", "dev_a"])
    expect({ code: result.code, out: result.out }).toEqual(device === "dev_a"
      ? { code: ACCOUNT_EXIT.ok, out: [{ forgotten: true }] }
      : { code: ACCOUNT_EXIT.conflict, out: [{ forgotten: false, device: { id: "dev_b", name: "device dev_b" } }] })
    expect(current()).toEqual(device === "dev_a" ? null : held)
  })

  test("#given corrupt credentials #when forget names a device #then unverifiable ownership never permits deletion", async () => {
    const calls: string[] = []
    const store = createCredentialStore("http://127.0.0.1:1", { platform: "darwin", secrets: {
      get: async () => { calls.push("get"); return "{" },
      set: async () => { calls.push("set") },
      delete: async () => { calls.push("delete"); return true },
    } })
    const result = await run(store, ["forget", "--device", "dev_a"])
    expect({ code: result.code, out: result.out, calls }).toEqual({
      code: ACCOUNT_EXIT.failed, out: [{ forgotten: false, error: "unreadable-credential" }], calls: ["get"],
    })
  })

  test.each([
    { args: ["--device"] },
    { args: ["--device", ""] },
    { args: ["--device", "--replace"] },
    { args: ["--device=dev_b"] },
    { args: ["--devcie", "dev_b"] },
    { args: ["--unknown"] },
    { args: ["dev_b"] },
    { args: ["--device", "dev_b", "--device", "dev_a"] },
    { args: ["--device", "dev_a", "--unknown"] },
  ])("#given malformed forget arguments %j #when forgetting #then the store is not touched", async ({ args }) => {
    const held = credential("dev_a", 3_600_000)
    const calls: string[] = []
    const store: CredentialStore = {
      read: async () => { calls.push("get"); return held },
      readAuthoritative: async () => { calls.push("get-authoritative"); return held },
      write: async () => { calls.push("set") },
      clear: async () => { calls.push("delete") },
    }
    const result = await run(store, ["forget", ...args])
    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(calls).toEqual([])
  })

  test("adopt stores the credential and show reports the device without any secret", async () => {
    const { store, current } = memoryStore(null)
    const adopted = await run(store, ["adopt"], { stdin: JSON.stringify(credential("dev_a", 3_600_000)) })
    expect(adopted.code).toBe(ACCOUNT_EXIT.ok)
    expect(current()?.device.id).toBe("dev_a")

    const shown = await run(store, ["show"])
    expect(shown.out).toEqual([{ signedIn: true, device: { id: "dev_a", name: "device dev_a" }, refreshState: "ok" }])
    expect(JSON.stringify(shown.out)).not.toContain("rt-dev_a")
  })

  test("adopt refuses a different device, writes nothing, and --replace takes over", async () => {
    const held = credential("dev_cli", 3_600_000)
    const { store, current } = memoryStore(held)
    const refused = await run(store, ["adopt"], { stdin: JSON.stringify(credential("dev_desk", 3_600_000)) })
    expect(refused.code).toBe(ACCOUNT_EXIT.conflict)
    expect(refused.out).toEqual([{ conflict: { device: { id: "dev_cli", name: "device dev_cli" } } }])
    expect(current()).toEqual(held)

    const replaced = await run(store, ["adopt", "--replace"], { stdin: JSON.stringify(credential("dev_desk", 3_600_000)) })
    expect(replaced.code).toBe(ACCOUNT_EXIT.ok)
    expect(current()?.device.id).toBe("dev_desk")
  })

  test.each([false, true])("adopting the same device with replace %s keeps the newer token, so an older copy cannot roll the refresh token back", async replace => {
    const newer = credential("dev_a", 3_600_000, "rt-newer")
    const { store, current } = memoryStore(newer)
    const adopted = await run(store, replace ? ["adopt", "--replace"] : ["adopt"], { stdin: JSON.stringify(credential("dev_a", 60_000, "rt-older")) })
    expect(adopted.code).toBe(ACCOUNT_EXIT.ok)
    expect(current()?.refreshToken).toBe("rt-newer")
  })

  test("adopt rejects input that is not a credential", async () => {
    const { store, current } = memoryStore(null)
    const result = await run(store, ["adopt"], { stdin: '{"accessToken":"x"}' })
    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(current()).toBeNull()
  })

  test("token refreshes an expiring credential once and returns the new access token", async () => {
    const service = fakeService(() =>
      Response.json({
        accessToken: "at-fresh",
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: "rt-next",
      }),
    )
    try {
      const { store, current } = memoryStore(credential("dev_a", 1_000, "rt-first"))
      const result = await run(store, ["token"], { api: service.api })
      expect(result.code).toBe(ACCOUNT_EXIT.ok)
      expect(result.out[0]).toMatchObject({ accessToken: "at-fresh", device: { id: "dev_a" } })
      expect(service.refreshTokens).toEqual(["rt-first"])
      expect(current()?.refreshToken).toBe("rt-next")
    } finally {
      service.stop()
    }
  })

  // The desktop tells the person why the sign-in ended (desktop#3522), so exit 5 names the service's
  // refusal code; the service message never reaches stdout.
  test.each(["reauth_required", "unauthorized", "invalid_grant", "account_deleted"])(
    "a refused refresh (%s) ends the session: the item is cleared and token exits 5 naming the code",
    async code => {
      const service = fakeService(() =>
        Response.json({ error: { code, message: "rt-first leaked", retryable: false, requestId: "r" } }, { status: code === "account_deleted" ? 410 : 401 }),
      )
      try {
        const { store, current } = memoryStore(credential("dev_a", 1_000))
        const result = await run(store, ["token"], { api: service.api })
        expect(result.code).toBe(ACCOUNT_EXIT.ended)
        expect(result.out).toEqual([{ ended: { code } }])
        expect(JSON.stringify(result.out)).not.toContain("rt-first")
        expect(current()).toBeNull()
      } finally {
        service.stop()
      }
    },
  )

  test("signed out: token and export exit 4, show says signed out", async () => {
    const { store } = memoryStore(null)
    expect((await run(store, ["token"])).code).toBe(ACCOUNT_EXIT.signedOut)
    expect((await run(store, ["export"])).code).toBe(ACCOUNT_EXIT.signedOut)
    expect((await run(store, ["show"])).out).toEqual([{ signedIn: false }])
  })

  test("show --account reports whether this device joined memory sync for that account, from its trust pin", async () => {
    const world = await createWorld("acct-show")
    const pinDir = mkdtempSync(join(tmpdir(), "omo-account-pins-"))
    homes.push(pinDir)
    const { store } = memoryStore(credential("dev_a", 3_600_000))

    const before = await run(store, ["show", "--account", world.account], { pinDir })
    expect(before.out[0]).toMatchObject({ signedIn: true, sync: "not_joined" })

    const walked = await appendEntries(
      emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)),
      world.server.chain(world.account),
      createRejectionCounter(),
    )
    if (!walked.ok || walked.state.pin === null) throw new Error("the fixture genesis does not anchor")
    await pinTrustAnchor(pinDir, world.account, walked.state.pin)
    const after = await run(store, ["show", "--account", world.account], { pinDir })
    expect(after.out[0]).toMatchObject({ signedIn: true, sync: "joined" })

    expect((await run(store, ["show", "--account"], { pinDir })).code).toBe(ACCOUNT_EXIT.invalid)
  }, 30_000)

  test("export returns the stored credential and forget clears it", async () => {
    const held = credential("dev_a", 3_600_000)
    const { store, current } = memoryStore(held)
    expect((await run(store, ["export"])).out).toEqual([held])
    const forgot = await run(store, ["forget"])
    expect(forgot.out).toEqual([{ forgotten: true }])
    expect(current()).toBeNull()
  })
})

describe("omo account on a locked OS credential store (desktop#3509)", () => {
  test("every verb reports keychain locked as its own exit code, never a generic failure", async () => {
    const locked = () => Promise.reject(Object.assign(new Error("SecKeychain write failed (-25308)"), { code: "ERR_SECRETS_PLATFORM_ERROR" }))
    const store = createCredentialStore("http://127.0.0.1:1", { secrets: { get: locked, set: locked, delete: locked }, platform: "darwin" })
    for (const [args, stdin] of [[["show"]], [["token"]], [["export"]], [["forget"]], [["adopt"], JSON.stringify(credential("dev_x", 60_000))]] as const) {
      const result = await run(store, [...args], stdin === undefined ? {} : { stdin })
      expect({ args, code: result.code, out: result.out }).toEqual({ args, code: ACCOUNT_EXIT.keychainLocked, out: [{ keychain: "locked" }] })
      expect(result.err.join("\n")).toContain("macOS Keychain is locked")
    }
  })

  test("an immediate native store failure returns store-unavailable", async () => {
    const broken = () => Promise.reject(new Error("boom"))
    const store = createCredentialStore("http://127.0.0.1:1", { secrets: { get: broken, set: broken, delete: broken }, platform: "darwin" })
    const result = await run(store, ["show"])
    expect(result.code).toBe(9)
    expect(result.out).toEqual([{ error: "store-unavailable" }])
  })
})

describe("omo account storage failures do not trigger another store call", () => {
  test("#given a native delete failure #when forgetting #then it reports the store failure without a read", async () => {
    const calls: string[] = []
    const store = createCredentialStore("http://127.0.0.1:1", { platform: "darwin", secrets: {
      get: async () => { calls.push("get"); return null },
      set: async () => { calls.push("set") },
      delete: async () => { calls.push("delete"); throw new Error("synthetic native delete failure") },
    } })
    const result = await run(store, ["forget"])
    expect({ code: result.code, out: result.out, calls }).toEqual({ code: ACCOUNT_EXIT.storeUnavailable, out: [{ error: "store-unavailable" }], calls: ["delete"] })
  })

  test.each(["show", "adopt", "token", "export"])("%s awaits a native get failure and reports it after exactly one store call", async verb => {
    // given
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<never>()
    const calls: string[] = []
    const store = createCredentialStore("http://127.0.0.1:1", { secrets: {
        get: async () => {
          calls.push("get")
          entered.resolve()
          return pending.promise
        },
        set: async () => {
          calls.push("set")
        },
        delete: async () => {
          calls.push("delete")
          return true
        },
      }, platform: "darwin" })

    // when
    const operation = run(store, [verb], { stdin: JSON.stringify(credential("dev_wait", 60_000)) })
    await entered.promise
    pending.reject(new Error("native get timed out: rt-private"))
    const result = await operation

    // then
    expect(calls).toEqual(["get"])
    expect({ code: result.code, out: result.out }).toEqual({ code: 9, out: [{ error: "store-unavailable" }] })
    expect(result.err.join("\n")).not.toContain("rt-private")
  })

  test.each(["journal", "replacement", "delete"] as const)("token preserves a deferred native %s failure without an error-path read", async stage => {
    // given
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<never>()
    const calls: string[] = []
    const service = fakeService(() =>
      stage === "delete"
        ? Response.json({ error: { code: "unauthorized", message: "refused", retryable: false, requestId: "r" } }, { status: 401 })
        : Response.json({ accessToken: "at-next", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), refreshToken: "rt-next" }),
    )
    let value = JSON.stringify(credential("dev_wait", -60_000))
    let writes = 0
    const fail = () => {
      entered.resolve()
      return pending.promise
    }
    const store = createCredentialStore(service.api, { secrets: {
        get: async () => {
          calls.push("get")
          return value
        },
        set: async ({ value: next }) => {
          calls.push("set")
          writes += 1
          if (stage === "journal" || (stage === "replacement" && writes === 2)) await fail()
          value = next
        },
        delete: async () => {
          calls.push("delete")
          await fail()
          return true
        },
      }, platform: "darwin" })
    try {
      // when
      const operation = run(store, ["token"], { api: service.api })
      await entered.promise
      const callsBeforeFailure = [...calls]
      pending.reject(new Error("native operation timed out: rt-private"))
      const result = await operation

      // then
      expect(calls).toEqual(callsBeforeFailure)
      expect(calls.filter(call => call === (stage === "delete" ? "delete" : "set"))).toHaveLength(stage === "replacement" ? 2 : 1)
      expect({ code: result.code, out: result.out }).toEqual({ code: 9, out: [{ error: "store-unavailable" }] })
      expect(result.err.join("\n")).not.toContain("rt-private")
      expect(JSON.parse(value).refreshState).toBe(stage === "journal" ? undefined : "uncertain")
    } finally {
      service.stop()
    }
  })

  test("invalid stored credentials remain a non-storage failure", async () => {
    const store = createCredentialStore("http://127.0.0.1:1", { secrets: {
        get: async () => "not-json",
        set: async () => {},
        delete: async () => true,
      }, platform: "darwin" })
    const result = await run(store, ["show"])
    expect({ code: result.code, out: result.out }).toEqual({ code: ACCOUNT_EXIT.failed, out: [] })
  })
})

describe("omo account on Linux, where a locked Secret Service read looks empty (desktop#3509)", () => {
  const empty = { get: async () => null, set: async () => {}, delete: async () => true }
  const linuxStore = (
    lock: "locked" | "unlocked" | "absent" | "unknown",
    secrets: SecretApi = empty,
    notices: string[] = [],
  ) =>
    createCredentialStore("http://127.0.0.1:1", { secrets, platform: "linux", lockProbe: async () => lock, notice: message => {
        notices.push(message)
      } })
  const memorySecretApi = () => {
    const values = new Map<string, string>()
    return {
      get: async ({ name }: { name: string }) => values.get(name) ?? null,
      set: async ({ name, value }: { name: string; value: string }) => {
        values.set(name, value)
      },
      delete: async ({ name }: { name: string }) => values.delete(name),
    }
  }
  const loginShowLogout = async (store: ReturnType<typeof createCredentialStore>) => [
    (await run(store, ["adopt"], { stdin: JSON.stringify(credential("dev_f", 60_000)) })).code,
    (await run(store, ["show"])).out[0],
    (await run(store, ["forget"])).code,
    (await run(store, ["show"])).out[0],
  ]

  test("a locked default collection is keychain_locked for show, token and adopt, never signed out", async () => {
    for (const [args, stdin] of [[["show"]], [["token"]], [["adopt"], JSON.stringify(credential("dev_l", 60_000))]] as const) {
      const result = await run(linuxStore("locked"), [...args], stdin === undefined ? {} : { stdin })
      expect({ args, code: result.code, out: result.out }).toEqual({ args, code: ACCOUNT_EXIT.keychainLocked, out: [{ keychain: "locked" }] })
    }
  })

  test("a locked collection is never touched: no secret call, so the keyring has nothing to prompt for", async () => {
    const calls: string[] = []
    const watched = {
      get: async () => {
        calls.push("get")
        return null
      },
      set: async () => {
        calls.push("set")
      },
      delete: async () => {
        calls.push("delete")
        return true
      },
    }
    for (const [args, stdin] of [[["show"]], [["forget"]], [["adopt"], JSON.stringify(credential("dev_n", 60_000))]] as const) {
      const result = await run(linuxStore("locked", watched), [...args], stdin === undefined ? {} : { stdin })
      expect(result.code).toBe(ACCOUNT_EXIT.keychainLocked)
    }
    expect(calls).toEqual([])
  })

  // #10658 review: only a LOCKED answer may stop the store. A probe that cannot answer (no gdbus on a minimal
  // install, no Secret Service name, a slow bus) falls back to libsecret as before, with one notice.
  // The notice itself is once per process; account-cli-entry.test.ts counts it through the real `omo account`.
  test("a probe that cannot answer never blocks login, show or logout: libsecret is used", async () => {
    for (const lock of ["absent", "unknown"] as const) {
      expect(await loginShowLogout(linuxStore(lock, memorySecretApi()))).toEqual([
        ACCOUNT_EXIT.ok,
        { signedIn: true, device: { id: "dev_f", name: "device dev_f" }, refreshState: "ok" },
        ACCOUNT_EXIT.ok,
        { signedIn: false },
      ])
    }
  })

  test("login and logout on Linux with no gdbus on PATH still succeed through the real probe", async () => {
    const path = process.env.PATH
    const emptyBin = mkdtempSync(join(tmpdir(), "omo-no-gdbus-"))
    homes.push(emptyBin)
    process.env.PATH = emptyBin
    try {
      const store = createCredentialStore("http://127.0.0.1:1", { secrets: memorySecretApi(), platform: "linux", notice: () => {} })
      expect(await loginShowLogout(store)).toEqual([
        ACCOUNT_EXIT.ok,
        { signedIn: true, device: { id: "dev_f", name: "device dev_f" }, refreshState: "ok" },
        ACCOUNT_EXIT.ok,
        { signedIn: false },
      ])
    } finally {
      process.env.PATH = path
    }
  })

  test("a sign-out by another process during token reads as signed out (4), not as an ended session", async () => {
    let reads = 0
    const store: CredentialStore = {
      read: async () => (reads++ === 0 ? credential("dev_r", -60_000) : null),
      readAuthoritative: async () => (reads++ === 0 ? credential("dev_r", -60_000) : null),
      write: async () => {},
      clear: async () => {},
    }
    const result = await run(store, ["token"])
    expect({ code: result.code, out: result.out }).toEqual({ code: ACCOUNT_EXIT.signedOut, out: [{ signedIn: false }] })
  })

  test("a keychain that locks mid-refresh keeps its own outcome (7), even when the read after it succeeds", async () => {
    const store: CredentialStore = {
      read: async () => credential("dev_k", -60_000),
      readAuthoritative: async () => credential("dev_k", -60_000),
      write: async () => {
        throw new KeychainLockedError("macOS Keychain is locked.")
      },
      clear: async () => {},
    }
    const result = await run(store, ["token"])
    expect({ code: result.code, out: result.out }).toEqual({ code: ACCOUNT_EXIT.keychainLocked, out: [{ keychain: "locked" }] })
  })

  test("an unlocked answer is asked once per process, not before every secret call", async () => {
    let probes = 0
    const store = createCredentialStore("http://127.0.0.1:1", { secrets: memorySecretApi(), platform: "linux", lockProbe: async () => {
        probes += 1
        return "unlocked"
      }, notice: () => {} })
    await loginShowLogout(store)
    expect(probes).toBe(1)
  })

  test("an unlocked collection with no item is still signed out", async () => {
    const result = await run(linuxStore("unlocked"), ["show"])
    expect({ code: result.code, out: result.out }).toEqual({ code: ACCOUNT_EXIT.ok, out: [{ signedIn: false }] })
  })

  test("libsecret's own locked-collection write error (measured on a real keyring) is keychain_locked", async () => {
    const lockedWrite = () =>
      Promise.reject(Object.assign(new Error("Cannot create an item in a locked collection (code: 2)"), { code: "ERR_SECRETS_PLATFORM_ERROR" }))
    const store = linuxStore("unlocked", { ...empty, set: lockedWrite })
    const result = await run(store, ["adopt"], { stdin: JSON.stringify(credential("dev_w", 60_000)) })
    expect({ code: result.code, out: result.out }).toEqual({ code: ACCOUNT_EXIT.keychainLocked, out: [{ keychain: "locked" }] })
  })
})
