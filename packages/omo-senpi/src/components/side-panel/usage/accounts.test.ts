import { describe, expect, test } from "bun:test"

import { resolveUsageCredential, resolveUsageCredentialFrom } from "./accounts"

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

  test("#given every account is on cooldown #when resolved #then no blocked credential is offered", () => {
    // given
    const file = auth([{ name: "work", access: token("work") }], "work")
    const slots = pool({ work: { cooldownUntil: NOW + 60_000 } })

    // when / then
    expect(resolveUsageCredential(file, slots, PROVIDER, NOW)).toBeUndefined()
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

describe("the provider ids senpi renamed", () => {
  // The engine renamed its subscription providers: auth.json now carries `anthropic-subscription`
  // and `chatgpt-subscription` where it used to carry `claude-sdk-oauth` and `openai-codex`.
  // Reading only the retired name means no credential, no poll, and a usage block that silently
  // ages - which is exactly how this was found: bars frozen with "43h ago" on them.
  const CURRENT = "anthropic-subscription"
  const LEGACY = "claude-sdk-oauth"
  const IDS = [CURRENT, LEGACY] as const

  const node = (accounts: readonly Record<string, unknown>[], pinned?: string) => ({
    type: "oauth",
    accounts,
    ...(pinned === undefined ? {} : { pinned }),
  })

  test("#given auth under the current name #when resolved #then the credential is found", () => {
    // given
    const credential = resolveUsageCredentialFrom(
      { [CURRENT]: node([{ name: "work", access: token("work") }], "work") },
      undefined,
      IDS,
      NOW,
    )

    // then
    expect(credential?.account).toBe("work")
    expect(credential?.access).toBe(token("work"))
  })

  test("#given an install that still uses the retired name #when resolved #then it keeps working", () => {
    // given the engine kept the old spelling as a legacy alias, and so does this
    const credential = resolveUsageCredentialFrom(
      { [LEGACY]: node([{ name: "work", access: token("work") }], "work") },
      undefined,
      IDS,
      NOW,
    )

    // then
    expect(credential?.account).toBe("work")
  })

  test("#given both names present #when resolved #then the current one wins", () => {
    // given a migrated install can carry both for a while
    const credential = resolveUsageCredentialFrom(
      {
        [CURRENT]: node([{ name: "current", access: token("current") }], "current"),
        [LEGACY]: node([{ name: "legacy", access: token("legacy") }], "legacy"),
      },
      undefined,
      IDS,
      NOW,
    )

    // then
    expect(credential?.account).toBe("current")
  })

  test("#given health recorded under the retired pool key #when resolved #then the healthy account serves", () => {
    // given auth and the credential pool were renamed on different schedules
    const credential = resolveUsageCredentialFrom(
      {
        [CURRENT]: node(
          [
            { name: "work", access: token("work") },
            { name: "personal", access: token("personal") },
          ],
          "work",
        ),
      },
      { providers: { [LEGACY]: { lanes: { stored: { slots: { work: { blockedUntil: NOW + 60_000 } } } } } } },
      IDS,
      NOW,
    )

    // then
    expect(credential).toEqual({
      access: token("personal"),
      state: "ok",
      account: "personal",
      pinnedAccount: "work",
    })
  })

  test("#given no signed-in provider at all #when resolved #then nothing is invented", () => {
    // given
    expect(resolveUsageCredentialFrom({ "some-other-provider": node([]) }, undefined, IDS, NOW)).toBeUndefined()
  })
})
