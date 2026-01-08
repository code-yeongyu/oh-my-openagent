import { saveAccounts } from "./storage"
import { parseStoredToken, formatTokenForStorage } from "./token"
import {
  MODEL_FAMILIES,
  type AccountStorage,
  type AccountMetadata,
  type AccountTier,
  type AntigravityRefreshParts,
  type ModelFamily,
  type RateLimitState,
} from "./types"

export interface ManagedAccount {
  index: number
  parts: AntigravityRefreshParts
  access?: string
  expires?: number
  rateLimits: RateLimitState
  lastUsed: number
  email?: string
  tier?: AccountTier
}

interface AuthDetails {
  refresh: string
  access: string
  expires: number
}

interface OAuthAuthDetails {
  type: "oauth"
  refresh: string
  access: string
  expires: number
}

function isRateLimitedForFamily(account: ManagedAccount, family: ModelFamily): boolean {
  const resetTime = account.rateLimits[family]
  return resetTime !== undefined && Date.now() < resetTime
}

export class AccountManager {
  private accounts: ManagedAccount[] = []
  private currentIndex = 0
  private activeIndex = 0

  constructor(auth: AuthDetails, storedAccounts?: AccountStorage | null) {
    if (storedAccounts && storedAccounts.accounts.length > 0) {
      const validActiveIndex =
        typeof storedAccounts.activeIndex === "number" &&
        storedAccounts.activeIndex >= 0 &&
        storedAccounts.activeIndex < storedAccounts.accounts.length
          ? storedAccounts.activeIndex
          : 0

      this.activeIndex = validActiveIndex
      this.currentIndex = validActiveIndex

      this.accounts = storedAccounts.accounts.map((acc, index) => ({
        index,
        parts: {
          refreshToken: acc.refreshToken,
          projectId: acc.projectId,
          managedProjectId: acc.managedProjectId,
        },
        access: index === validActiveIndex ? auth.access : acc.accessToken,
        expires: index === validActiveIndex ? auth.expires : acc.expiresAt,
        rateLimits: acc.rateLimits ?? {},
        lastUsed: 0,
        email: acc.email,
        tier: acc.tier,
      }))
    } else {
      this.activeIndex = 0
      this.currentIndex = 0

      const parts = parseStoredToken(auth.refresh)
      this.accounts.push({
        index: 0,
        parts,
        access: auth.access,
        expires: auth.expires,
        rateLimits: {},
        lastUsed: 0,
      })
    }
  }

  getAccountCount(): number {
    return this.accounts.length
  }

  getCurrentAccount(): ManagedAccount | null {
    if (this.activeIndex >= 0 && this.activeIndex < this.accounts.length) {
      return this.accounts[this.activeIndex] ?? null
    }
    return null
  }

  getAccounts(): ManagedAccount[] {
    return [...this.accounts]
  }

  getCurrentOrNextForFamily(family: ModelFamily): ManagedAccount | null {
    for (const account of this.accounts) {
      this.clearExpiredRateLimits(account)
    }

    const current = this.getCurrentAccount()
    if (current) {
      if (!isRateLimitedForFamily(current, family)) {
        const betterTierAvailable =
          current.tier !== "paid" &&
          this.accounts.some((a) => a.tier === "paid" && !isRateLimitedForFamily(a, family))

        if (!betterTierAvailable) {
          current.lastUsed = Date.now()
          return current
        }
      }
    }

    const next = this.getNextForFamily(family)
    if (next) {
      this.activeIndex = next.index
    }
    return next
  }

  getNextForFamily(family: ModelFamily): ManagedAccount | null {
    const available = this.accounts.filter((a) => !isRateLimitedForFamily(a, family))

    if (available.length === 0) {
      return null
    }

    const paidAvailable = available.filter((a) => a.tier === "paid")
    const pool = paidAvailable.length > 0 ? paidAvailable : available

    const account = pool[this.currentIndex % pool.length]
    if (!account) {
      return null
    }

    this.currentIndex++
    account.lastUsed = Date.now()
    return account
  }

  markRateLimited(account: ManagedAccount, retryAfterMs: number, family: ModelFamily): void {
    account.rateLimits[family] = Date.now() + retryAfterMs
  }

  clearExpiredRateLimits(account: ManagedAccount): void {
    const now = Date.now()
    for (const family of MODEL_FAMILIES) {
      if (account.rateLimits[family] !== undefined && now >= account.rateLimits[family]!) {
        delete account.rateLimits[family]
      }
    }
  }

  addAccount(
    parts: AntigravityRefreshParts,
    access?: string,
    expires?: number,
    email?: string,
    tier?: AccountTier
  ): void {
    this.accounts.push({
      index: this.accounts.length,
      parts,
      access,
      expires,
      rateLimits: {},
      lastUsed: 0,
      email,
      tier,
    })
  }

  removeAccount(index: number): boolean {
    if (index < 0 || index >= this.accounts.length) {
      return false
    }

    this.accounts.splice(index, 1)

    if (index < this.activeIndex) {
      this.activeIndex--
    } else if (index === this.activeIndex) {
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.accounts.length - 1))
    }

    if (index < this.currentIndex) {
      this.currentIndex--
    } else if (index === this.currentIndex) {
      this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.accounts.length - 1))
    }

    for (let i = 0; i < this.accounts.length; i++) {
      this.accounts[i]!.index = i
    }

    return true
  }

  async save(path?: string): Promise<void> {
    const storage: AccountStorage = {
      version: 1,
      accounts: this.accounts.map((acc) => ({
        email: acc.email ?? "",
        tier: acc.tier ?? "free",
        refreshToken: acc.parts.refreshToken,
        projectId: acc.parts.projectId ?? "",
        managedProjectId: acc.parts.managedProjectId,
        accessToken: acc.access ?? "",
        expiresAt: acc.expires ?? 0,
        rateLimits: acc.rateLimits,
      })),
      activeIndex: Math.max(0, this.activeIndex),
    }

    await saveAccounts(storage, path)
  }

  toAuthDetails(): OAuthAuthDetails {
    const current = this.getCurrentAccount() ?? this.accounts[0]
    if (!current) {
      throw new Error("No accounts available")
    }

    const allRefreshTokens = this.accounts
      .map((acc) => formatTokenForStorage(acc.parts.refreshToken, acc.parts.projectId ?? "", acc.parts.managedProjectId))
      .join("|||")

    return {
      type: "oauth",
      refresh: allRefreshTokens,
      access: current.access ?? "",
      expires: current.expires ?? 0,
    }
  }
}
