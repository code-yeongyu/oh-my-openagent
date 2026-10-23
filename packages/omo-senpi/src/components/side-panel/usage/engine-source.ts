import type { SenpiAccountLimits } from "../../../extension/types"
import { CLAUDE_PROVIDERS, CODEX_PROVIDERS } from "../constants"
import { resolveUsageCredentialFrom, type PanelUsageCredential } from "./accounts"
import type { UsageCredentialSource } from "./credentials"
import {
  USAGE_PROVIDER_KEYS,
  type PanelUsageEntry,
  type PanelUsageProviderKey,
  type PanelUsageSnapshot,
  type PanelUsageWindow,
} from "./types"

export interface EngineLimits {
  get(): readonly SenpiAccountLimits[]
  subscribe(listener: () => void): () => void
}

export interface UsageSource {
  snapshot(): PanelUsageSnapshot
  /** Re-reads which account is serving; a pool rotation must not leave the old account's numbers up. */
  refresh(): void
  stop(): void
}

const PROVIDER_IDS: Readonly<Record<PanelUsageProviderKey, readonly string[]>> = {
  claude: CLAUDE_PROVIDERS,
  codex: CODEX_PROVIDERS,
}

/**
 * Subscription usage, read from the engine (senpi#3684). senpi polls each signed-in account's usage
 * endpoint and folds every turn's reports into one record per account, so the panel only decides which
 * account is serving and draws that account's record - the same numbers the desktop shows.
 */
export function createEngineUsageSource(deps: {
  readonly limits: EngineLimits
  readonly readCredentials: () => UsageCredentialSource
  readonly now: () => number
  readonly onChange: () => void
}): UsageSource {
  let snapshot: PanelUsageSnapshot = {}
  const rebuild = (): void => {
    const { auth, pool } = deps.readCredentials()
    const records = deps.limits.get()
    const next: { -readonly [K in PanelUsageProviderKey]?: PanelUsageEntry } = {}
    for (const key of USAGE_PROVIDER_KEYS) {
      const credential = resolveUsageCredentialFrom(auth, pool, PROVIDER_IDS[key], deps.now())
      const record = servingRecord(records, PROVIDER_IDS[key], credential)
      if (record !== undefined) next[key] = entryOf(record, credential)
    }
    snapshot = next
    deps.onChange()
  }
  const unsubscribe = deps.limits.subscribe(rebuild)
  rebuild()
  return { snapshot: () => snapshot, refresh: rebuild, stop: unsubscribe }
}

/**
 * The serving account's record. Only when no stored login names a serving account (an env or ambient
 * login) does the provider's most recent record stand in; a named account with no record yet draws
 * nothing, so a rotation never shows the account the session just left.
 */
function servingRecord(
  records: readonly SenpiAccountLimits[],
  providers: readonly string[],
  credential: PanelUsageCredential | undefined,
): SenpiAccountLimits | undefined {
  const own = records.filter((record) => providers.includes(record.provider))
  if (credential !== undefined) return own.find((record) => record.account === (credential.account ?? "default"))
  return (
    own.reduce<SenpiAccountLimits | undefined>(
      (latest, record) => (latest === undefined || record.reportedAt > latest.reportedAt ? record : latest),
      undefined,
    )
  )
}

function entryOf(record: SenpiAccountLimits, credential: PanelUsageCredential | undefined): PanelUsageEntry {
  const updatedAt = Date.parse(record.reportedAt)
  const sameAccount = credential !== undefined && (credential.account ?? "default") === record.account
  return {
    windows: record.windows.map(windowOf),
    account: record.account,
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    ...(record.plan === undefined ? {} : { plan: record.plan }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(sameAccount ? { accountState: credential.state } : {}),
    ...(sameAccount && credential.pinnedAccount !== undefined ? { pinnedAccount: credential.pinnedAccount } : {}),
  }
}

function windowOf(window: SenpiAccountLimits["windows"][number]): PanelUsageWindow {
  const resetsAt = window.resetsAt === undefined ? undefined : Date.parse(window.resetsAt)
  return {
    label: window.label,
    percent: window.usedPercent,
    ...(resetsAt !== undefined && Number.isFinite(resetsAt) ? { resetsAt } : {}),
    ...(window.windowMinutes === undefined ? {} : { windowMs: window.windowMinutes * 60_000 }),
    ...(window.id.startsWith("claude:7d_") ? { scoped: true } : {}),
  }
}
