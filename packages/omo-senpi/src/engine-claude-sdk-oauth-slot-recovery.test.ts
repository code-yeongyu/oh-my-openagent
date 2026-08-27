import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Regression coverage for oh-my-openagent#7084 against the exact-pinned engine
// dist (@code-yeongyu/senpi). The claude-sdk-oauth slot/failover/affinity
// plumbing ships inside the pinned dependency, so the desired semantics are
// pinned here: re-login upserts one stable slot and auth_error blocks expire.
// Everything below runs on pure, dependency-injected modules - no real
// credential store is read or written.

const require = createRequire(import.meta.url)
const senpiPackageDir = dirname(require.resolve("@code-yeongyu/senpi/package.json"))
const oauthDistDir = join(senpiPackageDir, "dist", "core", "extensions", "builtin", "claude-sdk-oauth")

type AccountSlot = {
  name: string
  refresh: string
  access: string
  expires: number
  source: "login" | "import" | "env"
  blockedUntil?: number
  blockReason?: string
}

type SlotCredential = {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accounts?: AccountSlot[]
  pinned?: string
  slotState?: Record<string, { blockedUntil?: number; blockReason?: string }>
}

type LoginCredential = { access: string; refresh: string; expires: number }

type AccountsModule = {
  SENTINEL_OAUTH_FIELDS: { access: string; refresh: string; expires: number }
  emptyCredential(): SlotCredential
  listAccounts(credential: SlotCredential): AccountSlot[]
  addAccount(credential: SlotCredential, slot: AccountSlot): SlotCredential
  upsertAccount(credential: SlotCredential, slot: AccountSlot): SlotCredential
  assertSentinelInvariant(credential: SlotCredential): void
}

type OAuthLoginCallbacksShape = {
  signal?: AbortSignal
  onPrompt?: (prompt: { message: string; placeholder?: string }) => Promise<string>
}

type OAuthLoginModule = {
  createOAuthConfig(deps: {
    readCurrent: () => Promise<SlotCredential | undefined>
    loginFlow?: { login(interaction: unknown): Promise<LoginCredential> }
  }): {
    login(callbacks: OAuthLoginCallbacksShape): Promise<SlotCredential>
  }
}

type FailoverModule = {
  AUTH_ERROR_BLOCK_MS: number
  runFailover(input: {
    accounts: readonly AccountSlot[]
    selectFn: (accounts: readonly AccountSlot[]) => AccountSlot
    runAttempt: (slot: AccountSlot) => AsyncIterable<unknown>
    classify: (error: unknown) => { kind: string; retryable: boolean }
    store: InMemoryStore
    providerId: string
    now?: () => number
    baseBlockMs?: number
  }): AsyncGenerator<unknown>
}

type AffinityModule = {
  selectAccount(
    accounts: readonly AccountSlot[],
    options?: { now?: () => number; sessionId?: string; pinnedAccount?: string },
  ): AccountSlot
  clearExpiredBlocks(accounts: readonly AccountSlot[], now?: number): AccountSlot[]
}

type InMemoryStore = {
  credential: SlotCredential | undefined
  modify(providerId: string, transform: (current: SlotCredential | undefined) => SlotCredential | undefined): Promise<SlotCredential | undefined>
}

async function loadDistModule<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(join(oauthDistDir, file)).href)) as T
}

function loginCredential(suffix: string): LoginCredential {
  return { access: `access-${suffix}`, refresh: `refresh-${suffix}`, expires: 1_000 + suffix.length }
}

function loginSlot(name: string, suffix: string, extra: Partial<AccountSlot> = {}): AccountSlot {
  const credential = loginCredential(suffix)
  return { name, access: credential.access, refresh: credential.refresh, expires: credential.expires, source: "login", ...extra }
}

function createInMemoryStore(initial: SlotCredential): InMemoryStore {
  return {
    credential: initial,
    async modify(_providerId, transform) {
      this.credential = await transform(this.credential)
      return this.credential
    },
  }
}

const describeAccounts = () => loadDistModule<AccountsModule>("accounts.js")
const describeOAuthLogin = () => loadDistModule<OAuthLoginModule>("oauth-login.js")
const describeFailover = () => loadDistModule<FailoverModule>("failover.js")
const describeAffinity = () => loadDistModule<AffinityModule>("affinity.js")

describe("engine claude-sdk-oauth slot recovery (issue #7084)", () => {
  describe("#given the pinned senpi accounts module", () => {
    test("#then it exposes an upsert that replaces a same-name slot in place", async () => {
      const accounts = await describeAccounts()
      expect(typeof accounts.upsertAccount).toBe("function")

      // given a credential holding one already-blocked login slot
      const current = accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a", { blockReason: "auth_error" }))

      // when the same identity is upserted with fresh credentials
      const next = accounts.upsertAccount(current, loginSlot("default", "b"))

      // then the slot is replaced in place with block stamps stripped
      const slots = accounts.listAccounts(next)
      expect(slots.length).toBe(1)
      expect(slots[0]?.name).toBe("default")
      expect(slots[0]?.access).toBe("access-b")
      expect(slots[0]?.refresh).toBe("refresh-b")
      expect(slots[0]?.blockedUntil).toBeUndefined()
      expect(slots[0]?.blockReason).toBeUndefined()
      accounts.assertSentinelInvariant(next)
    })

    test("#then an unknown name still appends so explicit multi-account keeps working", async () => {
      const accounts = await describeAccounts()
      const current = accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a"))

      // when a distinct account name is upserted
      const next = accounts.upsertAccount(current, loginSlot("work", "b"))

      // then both slots exist
      expect(accounts.listAccounts(next).map((slot) => slot.name)).toEqual(["default", "work"])
    })
  })

  describe("#given a single logged-in Claude account #when /login succeeds again without an explicit new name", () => {
    test("#then the existing slot is refreshed in place instead of appending account-N+1", async () => {
      const accounts = await describeAccounts()
      const oauthLogin = await describeOAuthLogin()
      const current = accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a"))
      let stored = current
      const config = oauthLogin.createOAuthConfig({
        readCurrent: () => Promise.resolve(stored),
        loginFlow: { login: () => Promise.resolve(loginCredential("b")) },
      })

      // when the recovery login runs (headless path: no onPrompt callback)
      const next = await config.login({})
      stored = next

      // then one slot holds the fresh credentials under the stable name
      const slots = accounts.listAccounts(next)
      expect(slots.length).toBe(1)
      expect(slots[0]?.name).toBe("default")
      expect(slots[0]?.access).toBe("access-b")
      expect(slots[0]?.refresh).toBe("refresh-b")
    })

    test("#then a dead auth_error slot comes back live after re-login", async () => {
      const accounts = await describeAccounts()
      const oauthLogin = await describeOAuthLogin()
      const current = accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a", { blockReason: "auth_error" }))
      const config = oauthLogin.createOAuthConfig({
        readCurrent: () => Promise.resolve(current),
        loginFlow: { login: () => Promise.resolve(loginCredential("b")) },
      })

      // when the user follows the "after re-login" guidance
      const next = await config.login({})

      // then the recovered slot carries no block stamp
      const slots = accounts.listAccounts(next)
      expect(slots.length).toBe(1)
      expect(slots[0]?.blockReason).toBeUndefined()
      expect(slots[0]?.blockedUntil).toBeUndefined()
    })

    test("#then accepting the prompt placeholder recovers the newest login slot instead of minting account-N+1", async () => {
      const accounts = await describeAccounts()
      const oauthLogin = await describeOAuthLogin()
      const imported = { ...loginSlot("imported-anthropic", "i"), source: "import" as const }
      const withImport = accounts.upsertAccount(accounts.emptyCredential(), imported)
      const current = accounts.upsertAccount(withImport, loginSlot("default", "a"))
      const config = oauthLogin.createOAuthConfig({
        readCurrent: () => Promise.resolve(current),
        loginFlow: { login: () => Promise.resolve(loginCredential("b")) },
      })
      const promptedMessages: string[] = []

      // when the interactive prompt is answered with its own placeholder (empty input)
      const next = await config.login({
        onPrompt: async (prompt) => {
          promptedMessages.push(prompt.message)
          return ""
        },
      })

      // then the default slot was refreshed; no account-N+1 sibling appeared
      const slots = accounts.listAccounts(next)
      expect(slots.map((slot) => slot.name).sort()).toEqual(["default", "imported-anthropic"])
      const refreshed = slots.find((slot) => slot.name === "default")
      expect(refreshed?.access).toBe("access-b")
      expect(promptedMessages.length).toBe(1)
    })

    test("#then a typed brand-new name still adds a second account", async () => {
      const accounts = await describeAccounts()
      const oauthLogin = await describeOAuthLogin()
      const current = accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a"))
      const config = oauthLogin.createOAuthConfig({
        readCurrent: () => Promise.resolve(current),
        loginFlow: { login: () => Promise.resolve(loginCredential("b")) },
      })

      // when the user explicitly names a second account
      const next = await config.login({ onPrompt: () => Promise.resolve("work") })

      // then both accounts coexist and the old one is untouched
      const slots = accounts.listAccounts(next)
      expect(slots.map((slot) => slot.name).sort()).toEqual(["default", "work"])
      expect(slots.find((slot) => slot.name === "default")?.access).toBe("access-a")
    })
  })

  describe("#given failover classifies an authentication failure", () => {
    test("#then the auth_error stamp carries an expiry instead of blocking forever", async () => {
      const accounts = await describeAccounts()
      const failover = await describeFailover()
      const now = 1_000_000
      const store = createInMemoryStore(accounts.upsertAccount(accounts.emptyCredential(), loginSlot("default", "a")))
      const failingAttempt = async function* () {
        yield { type: "error", error: new Error("authentication_failed: invalid_grant") }
      }

      // when the single attempt fails with an auth_error classification
      const run = (async () => {
        for await (const _event of failover.runFailover({
          accounts: [loginSlot("default", "a")],
          selectFn: (candidates) => candidates[0] as AccountSlot,
          runAttempt: () => failingAttempt(),
          classify: () => ({ kind: "auth_error", retryable: true }),
          store,
          providerId: "claude-sdk-oauth",
          now: () => now,
        })) {
          // no events expected before the throw
        }
      })()

      // then the turn fails but the persisted stamp expires
      expect(run).rejects.toThrow("invalid_grant")
      await run.catch(() => undefined)
      const stamped = accounts.listAccounts(store.credential as SlotCredential)[0]
      expect(stamped?.blockReason).toBe("auth_error")
      expect(stamped?.blockedUntil).toBe(now + failover.AUTH_ERROR_BLOCK_MS)
      expect(failover.AUTH_ERROR_BLOCK_MS).toBeGreaterThan(0)
    })
  })

  describe("#given affinity selection over blocked slots", () => {
    test("#then an elapsed auth_error stamp no longer blocks selection", async () => {
      const accounts = await describeAccounts()
      const affinity = await describeAffinity()
      const now = 2_000_000
      const expiredAuthStamp = loginSlot("default", "a", { blockReason: "auth_error", blockedUntil: now - 1 })

      // when every slot carries only an elapsed auth_error stamp
      const selected = affinity.selectAccount([expiredAuthStamp], { now: () => now })

      // then the pool is not dead-ended
      expect(selected.name).toBe("default")
    })

    test("#then clearing blocks also cleans legacy auth_error stamps that never had an expiry", async () => {
      const accounts = await describeAccounts()
      const affinity = await describeAffinity()
      const legacyStamp = loginSlot("account-5", "a", { blockReason: "auth_error" })

      // when expired blocks are cleared at any time
      const cleared = affinity.clearExpiredBlocks([legacyStamp], 5_000_000)

      // then the permanent legacy stamp is gone
      expect(cleared[0]?.blockReason).toBeUndefined()
      expect(cleared[0]?.blockedUntil).toBeUndefined()
    })

    test("#then a live rate-limit window still blocks (existing behavior preserved)", async () => {
      const accounts = await describeAccounts()
      const affinity = await describeAffinity()
      const now = 3_000_000
      const rateLimited = loginSlot("default", "a", { blockReason: "rate_limit", blockedUntil: now + 60_000 })

      // when the block window is still in the future
      const cleared = affinity.clearExpiredBlocks([rateLimited], now)

      // then the stamp survives
      expect(cleared[0]?.blockReason).toBe("rate_limit")
      expect(cleared[0]?.blockedUntil).toBe(now + 60_000)
    })
  })
})
