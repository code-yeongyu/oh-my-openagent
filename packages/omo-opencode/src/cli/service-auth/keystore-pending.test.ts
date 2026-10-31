import { describe, expect, test } from "bun:test"
import { createCredentialStore, KeychainApprovalPendingError, type SecretApi } from "./keystore"
import { createSession } from "./session"
import { fakeApi, grant, privateKeys, refusal, temporaryHome } from "./test-support"

// A keychain read the OS never answers: the approval dialog nobody has clicked yet (#11262).
function pendingSecrets() {
  let gets = 0
  let answered: { readonly value: string | null } | undefined
  const waiting: Array<(value: string | null) => void> = []
  const api: SecretApi = {
    get: () => {
      gets += 1
      return answered === undefined ? new Promise<string | null>(resolve => waiting.push(resolve)) : Promise.resolve(answered.value)
    },
    set: async () => undefined,
    delete: async () => true,
  }
  const answer = (value: string | null) => {
    answered = { value }
    for (const resolve of waiting.splice(0)) resolve(value)
  }
  return { api, gets: () => gets, answer }
}

type Outcome<T> = { readonly state: "resolved"; readonly value: T } | { readonly state: "rejected"; readonly error: unknown } | { readonly state: "hung" }

// The test's own bound: a call that has not settled by then is the hang this file guards against.
async function settled<T>(work: Promise<T>, ms = 2_000): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<Outcome<T>>(resolve => {
    timer = setTimeout(() => resolve({ state: "hung" }), ms)
  })
  try {
    return await Promise.race([work.then((value): Outcome<T> => ({ state: "resolved", value }), (error: unknown): Outcome<T> => ({ state: "rejected", error })), hung])
  } finally {
    clearTimeout(timer)
  }
}

const unlocked = async () => "unlocked" as const
const quiet = () => undefined
const bounded = { kind: "bounded", deadlineMs: 50 } as const

function expectApprovalPending(outcome: Outcome<unknown>) {
  expect(outcome.state).toBe("rejected")
  const error = outcome.state === "rejected" ? outcome.error : undefined
  expect(error).toBeInstanceOf(KeychainApprovalPendingError)
  expect(String(error)).toContain("wants to access key omo-cli")
}

describe("a credential read the OS store does not answer", () => {
  test("#given an unanswered keychain dialog #when a session path reads the credential #then it fails fast with the typed approval error", async () => {
    const secrets = pendingSecrets()
    const store = createCredentialStore("https://api.omo.dev", { secrets: secrets.api, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
    expectApprovalPending(await settled(store.read()))
  })

  test("#given an unanswered keychain dialog #when callers read in parallel #then they share one OS read instead of stacking prompts", async () => {
    const secrets = pendingSecrets()
    const stores = [0, 1, 2].map(() => createCredentialStore("https://api.omo.dev", { secrets: secrets.api, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded }))
    const outcomes = await Promise.all([...stores, stores[0]].map(store => settled(store?.read() ?? Promise.resolve(null))))
    for (const outcome of outcomes) expectApprovalPending(outcome)
    const afterDeadline = await Promise.all(stores.map(store => settled(store.read())))
    for (const outcome of afterDeadline) expectApprovalPending(outcome)
    expect(secrets.gets()).toBe(1)
  })

  test("#given a read that timed out #when the person approves the dialog later #then the next read refreshes the native answer", async () => {
    const secrets = pendingSecrets()
    const store = createCredentialStore("https://api.omo.dev", { secrets: secrets.api, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
    expectApprovalPending(await settled(store.read()))
    secrets.answer(JSON.stringify({ ...grant, ...privateKeys }))
    await Promise.resolve()
    const outcome = await settled(store.read())
    expect(outcome.state === "resolved" ? outcome.value?.refreshToken : outcome).toBe(grant.refreshToken)
    expect(secrets.gets()).toBe(2)
  })

  test("#given a late approval in A #when B rotates the credential #then A uses ROTATED without refreshing or clearing the store", async () => {
    const old = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
    const rotated = { ...grant, ...privateKeys, refreshToken: "ROTATED", accessToken: "rotated-access" }
    let item: string | null = JSON.stringify(old)
    const approval = Promise.withResolvers<string | null>()
    let firstRead = true
    let clears = 0
    let refreshes = 0
    const api = fakeApi(() => { refreshes += 1; return refusal("reauth_required", undefined, 401) })
    const native: SecretApi = {
      get: async () => item,
      set: async ({ value }) => { item = value },
      delete: async () => { clears += 1; item = null; return true },
    }
    const a = createCredentialStore(api, { secrets: {
      ...native,
      get: () => {
        if (!firstRead) return Promise.resolve(item)
        firstRead = false
        return approval.promise
      },
    }, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
    const b = createCredentialStore(api, { secrets: native, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
    const session = createSession({ api, store: a, home: await temporaryHome() })
    expectApprovalPending(await settled(session.accessToken()))
    approval.resolve(item)
    await approval.promise
    await b.write(rotated)
    const outcome = await settled(session.accessToken())
    expect(outcome).toEqual({ state: "resolved", value: rotated.accessToken })
    const saved = await b.read()
    expect(saved?.credentialGeneration).toEqual(expect.any(String))
    expect(item === null ? null : JSON.parse(item)).toEqual({ ...rotated, credentialGeneration: saved?.credentialGeneration })
    expect(refreshes).toBe(0)
    expect(clears).toBe(0)
  })

  for (const action of ["write", "clear"] as const) {
    test(`#given a parked read #when own ${action} finishes before the stale read resolves #then the next read sees the mutation`, async () => {
      const old = JSON.stringify({ ...grant, ...privateKeys })
      const fresh = { ...grant, ...privateKeys, refreshToken: "NEW" }
      let item: string | null = old
      const approval = Promise.withResolvers<string | null>()
      let firstRead = true
      const native: SecretApi = {
        get: () => {
          if (!firstRead) return Promise.resolve(item)
          firstRead = false
          return approval.promise
        },
        set: async ({ value }) => { item = value },
        delete: async () => { item = null; return true },
      }
      const store = createCredentialStore("https://api.omo.dev", { secrets: native, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
      expectApprovalPending(await settled(store.read()))
      if (action === "write") await store.write(fresh)
      else await store.clear()
      approval.resolve(old)
      await approval.promise
      const saved = await store.read()
      if (action === "write") expect(saved?.credentialGeneration).toEqual(expect.any(String))
      expect(saved).toEqual(action === "write" ? { ...fresh, credentialGeneration: saved?.credentialGeneration } : null)
    })
  }

  test("#given an unanswered keychain dialog #when two token requests run one after the other #then each fails fast and the session lock is not held", async () => {
    const secrets = pendingSecrets()
    const store = createCredentialStore("https://api.omo.dev", { secrets: secrets.api, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: bounded })
    const session = createSession({ api: "https://api.omo.dev", store, home: await temporaryHome() })
    expectApprovalPending(await settled(session.accessToken()))
    expectApprovalPending(await settled(session.accessToken()))
  })

  test("#given an interactive command #when the keychain dialog is open #then it says it is waiting and keeps waiting for the answer", async () => {
    const secrets = pendingSecrets()
    let waitingNotice: (message: string) => void = () => undefined
    const noticed = new Promise<string>(resolve => {
      waitingNotice = resolve
    })
    const store = createCredentialStore("https://api.omo.dev", { secrets: secrets.api, platform: "darwin", lockProbe: unlocked, notice: quiet, wait: { kind: "interactive", noticeAfterMs: 20, notice: waitingNotice } })
    const read = store.read()
    const notice = await settled(noticed)
    expect(notice.state === "resolved" ? notice.value : notice).toContain("wants to access key omo-cli")
    secrets.answer(JSON.stringify({ ...grant, ...privateKeys }))
    const outcome = await settled(read)
    expect(outcome.state === "resolved" ? outcome.value?.refreshToken : outcome).toBe(grant.refreshToken)
  })
})
