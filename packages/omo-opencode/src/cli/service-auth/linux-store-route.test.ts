import { describe, expect, test } from "bun:test"
import { AsyncLocalStorage } from "node:async_hooks"
import type { SealedStore } from "./keystore"
import { type OpenKeyringState, routeLinuxStore } from "./linux-store-route"
import type { StateFileStore } from "./state-file-store"

// #13671 review L1: a sign-out that marks another context's file kept races a command that is about to migrate it. The
// credential lock is the only thing ordering them across processes, so this fake stands in for it: re-entrant within one
// async context like the real one, and it reports the moment a second holder has to wait, so each interleaving below
// is ordered by the lock itself rather than by timing.
function fakeLock() {
  const holder = new AsyncLocalStorage<true>()
  let tail: Promise<void> = Promise.resolve()
  let held = false
  let onWait: (() => void) | undefined
  const lock = async <R>(action: () => Promise<R>): Promise<R> => {
    if (holder.getStore()) return action()
    const previous = tail
    let release = () => {}
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    if (held) onWait?.()
    await previous
    held = true
    try {
      return await holder.run(true, action)
    } finally {
      held = false
      release()
    }
  }
  return {
    lock,
    isHeld: () => holder.getStore() === true,
    nextWait: () =>
      new Promise<"waited">((resolve) => {
        onWait = () => resolve("waited")
      }),
  }
}

const within = <T>(promise: Promise<T>, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`waited 5s for ${what}`)), 5_000)),
  ])

// The keyring holds sign-in A; the file holds B, written by a session with no session bus.
function world() {
  const lock = fakeLock()
  const moved: string[] = []
  const keyringClears: boolean[] = []
  let inKeyring: string | null = "A"
  const state = { present: true, kept: false, text: "B" }
  const keyring: SealedStore<string> = {
    read: async () => inKeyring,
    readAuthoritative: async () => inKeyring,
    write: async (value) => {
      inKeyring = value
    },
    clear: async () => {
      keyringClears.push(lock.isHeld())
      inKeyring = null
    },
  }
  const file: StateFileStore<string> = {
    read: async () => (state.present ? state.text : null),
    readAuthoritative: async () => (state.present ? state.text : null),
    write: async (value) => {
      Object.assign(state, { present: true, text: value })
    },
    clear: async () => {
      Object.assign(state, { present: false, kept: false })
    },
    text: async () => (state.present ? state.text : null),
    present: async () => state.present,
    kept: async () => state.kept,
    markKept: async () => {
      state.kept = true
    },
    directory: () => "<state dir>",
  }
  const store = (probe: () => Promise<OpenKeyringState>) =>
    routeLinuxStore({
      lock: lock.lock,
      keyring,
      file,
      probe,
      relation: async (text) => (inKeyring === null ? "empty" : inKeyring === text ? "older" : "other"),
      moveToKeyring: async (text) => {
        moved.push(text)
        inKeyring = text
      },
      notice: () => {},
    })
  // A sign-out held at its first step while it already holds the lock, as createCredentialStore's clear does.
  const heldSignOut = () => {
    let atProbe = () => {}
    const holding = new Promise<void>((resolve) => {
      atProbe = resolve
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const signOut = store(async () => {
      atProbe()
      await gate
      return "unlocked"
    })
    const done = lock.lock(() => signOut.clear())
    return { holding, release, done }
  }
  return { lock, store, state, moved, keyringClears, heldSignOut, keyringValue: () => inKeyring }
}

describe("a sign-out that keeps another context's state file, racing another command (#13671 review L1)", () => {
  test("#given a command that saw the file unmarked #when the sign-out marks it first #then the command never takes it over", async () => {
    const w = world()
    const signOut = w.heldSignOut()
    await within(signOut.holding, "the sign-out to hold the lock")
    const waited = w.lock.nextWait()
    const read = w.store(async () => "unlocked").read()
    await within(waited, "the command to wait on the credential lock")
    signOut.release()
    await within(signOut.done, "the sign-out")
    expect({
      read: await within(read, "the command"),
      moved: w.moved,
      keyring: w.keyringValue(),
      file: w.state,
    }).toEqual({
      read: null,
      moved: [],
      keyring: null,
      file: { present: true, kept: true, text: "B" },
    })
  })

  test("#given a probe that cannot answer #then the command waits for the sign-out instead of reading the file it is marking", async () => {
    const w = world()
    const signOut = w.heldSignOut()
    await within(signOut.holding, "the sign-out to hold the lock")
    const waited = w.lock.nextWait()
    const read = w.store(async () => "unknown").read()
    const first = await within(
      Promise.race([waited, read.then(() => "read without the lock" as const)]),
      "the command to wait or read",
    )
    signOut.release()
    await within(signOut.done, "the sign-out")
    expect({ first, read: await within(read, "the command"), moved: w.moved }).toEqual({
      first: "waited",
      read: null,
      moved: [],
    })
  })

  test("#when a sign-out marks the file #then the keyring item goes in the same lock hold", async () => {
    const w = world()
    await w.store(async () => "unlocked").clear()
    expect({ keyringClears: w.keyringClears, file: w.state }).toEqual({
      keyringClears: [true],
      file: { present: true, kept: true, text: "B" },
    })
  })
})
