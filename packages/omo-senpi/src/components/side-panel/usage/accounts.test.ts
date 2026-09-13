import { describe, expect, test } from "bun:test"

import { resolveUsageCredential } from "./accounts"

const NOW = 1_700_000_000_000
const PROVIDER = "claude-sdk-oauth"

/** Long enough to look like an access token; the short-token guard is tested on its own. */
const token = (name: string): string => `sk-ant-oat01-${name}-${"x".repeat(40)}`

const auth = (accounts: readonly Record<string, unknown>[], pinned?: string): Record<string, unknown> => ({
  [PROVIDER]: { type: "oauth", accounts, ...(pinned === undefined ? {} : { pinned }) },
})

const pool = (slots: Record<string, unknown>): Record<string, unknown> => ({
  providers: { [PROVIDER]: { lanes: { stored: { slots } } } },
})

describe("resolveUsageCredential", () => {
  test("#given a healthy pinned account #when resolved #then its own token and name come back", () => {
    // given
    const file = auth([{ name: "work", access: token("work") }, { name: "personal", access: token("personal") }], "work")

    // when
    const credential = resolveUsageCredential(file, undefined, PROVIDER, NOW)

    // then
    expect(credential).toEqual({ access: token("work"), state: "ok", account: "work" })
  })

  test("#given the pinned account is on cooldown #when resolved #then the healthy one serves and is marked", () => {
    // given the pool put the pinned slot on cooldown, so it is not the slot doing the work
    const file = auth([{ name: "work", access: token("work") }, { name: "personal", access: token("personal") }], "work")
    const slots = pool({ work: { blockedUntil: NOW + 60_000 } })

    // when
    const credential = resolveUsageCredential(file, slots, PROVIDER, NOW)

    // then
    expect(credential).toEqual({
      access: token("personal"),
      state: "ok",
      account: "personal",
      pinnedAccount: "work",
    })
  })

  test("#given every account is expired #when resolved #then the pinned one still serves, marked stale", () => {
    // given
    const file = auth([{ name: "work", access: token("work"), expires: NOW - 1 }], "work")

    // when
    const credential = resolveUsageCredential(file, undefined, PROVIDER, NOW)

    // then
    expect(credential?.state).toBe("stale")
    expect(credential?.account).toBe("work")
  })

  test("#given a single-account credential #when resolved #then the top-level token serves without a name", () => {
    // given
    const file = { [PROVIDER]: { access: token("flat") } }

    // when
    const credential = resolveUsageCredential(file, undefined, PROVIDER, NOW)

    // then
    expect(credential).toEqual({ access: token("flat"), state: "ok" })
  })

  test("#given only a short internal marker #when resolved #then nothing is offered", () => {
    // given the host's generic resolver hands back a short marker, and sending it as a bearer
    // earns a 429 with a 48-minute retry-after
    const file = { [PROVIDER]: { access: "oauth" } }

    // when / then
    expect(resolveUsageCredential(file, undefined, PROVIDER, NOW)).toBeUndefined()
  })

  test("#given a provider that is not configured #when resolved #then nothing is offered", () => {
    // given / when / then
    expect(resolveUsageCredential({}, undefined, PROVIDER, NOW)).toBeUndefined()
  })

  test("#given the pinned account is blocked in auth.json #when resolved #then the healthy one serves", () => {
    // given senpi records a rotation as blockedUntil ON THE ACCOUNT, and leaves the pool slot clean;
    // reading only the pool made the panel print the rotated-away name over somebody else's numbers
    const file = auth(
      [
        { name: "work", access: token("work"), blockedUntil: NOW + 60_000, blockReason: "rate_limit" },
        { name: "personal", access: token("personal") },
      ],
      "work",
    )

    // when
    const credential = resolveUsageCredential(file, undefined, PROVIDER, NOW)

    // then
    expect(credential).toEqual({
      access: token("personal"),
      state: "ok",
      account: "personal",
      pinnedAccount: "work",
    })
  })

  test("#given an account block that has already expired #when resolved #then the pinned account still serves", () => {
    // given a stale block must not hand the session away
    const file = auth([{ name: "work", access: token("work"), blockedUntil: NOW - 1 }], "work")

    // when / then
    expect(resolveUsageCredential(file, undefined, PROVIDER, NOW)).toEqual({
      access: token("work"),
      state: "ok",
      account: "work",
    })
  })
})
