import { log } from "../../../shared/logger"
import {
  createMuteWatcher,
  type MuteWatcher,
} from "../experiments/rate-limit-mute-watcher"
import type { MuteState } from "../experiments/rate-limit-types"
import type { AccountPool } from "./account-pool"
import { RATE_DEFAULTS } from "./defaults"
import { getGlobalTelemetry, type Telemetry } from "./telemetry"

export type WatcherSet = {
  start: () => void
  stop: () => Promise<void>
  getWatchers: () => ReadonlyMap<string, MuteWatcher>
}

export type WatcherSetArgs = {
  pool: AccountPool
  intervalMs?: number
  telemetry?: Telemetry
  watcherFactory?: (args: {
    accountId: string
    onFlip: (state: MuteState) => void
  }) => MuteWatcher
}

export function createPoolMuteWatchers(args: WatcherSetArgs): WatcherSet {
  const intervalMs = args.intervalMs ?? RATE_DEFAULTS.MUTE_WATCHER_NORMAL_MS
  const telemetry = args.telemetry ?? getGlobalTelemetry()
  const watchers = new Map<string, MuteWatcher>()

  for (const account of args.pool.list()) {
    const onFlip = (state: MuteState) => {
      args.pool.markMuted(account.id)
      args.pool.triggerCooldown(account.id)
      telemetry.record({
        account_id: account.id,
        error_type: "mute_observed",
        ts: Date.now(),
        request_id: `mute-watcher-${state.sampled_at}`,
      })
      log(
        `openai-compat-mute: account ${account.id} muted (sampled_at=${state.sampled_at} mute_until=${state.mute_until})`,
      )
    }
    const watcher = args.watcherFactory
      ? args.watcherFactory({ accountId: account.id, onFlip })
      : createMuteWatcher({
          provider: account.provider,
          baseUrl: account.baseUrl,
          intervalMs,
          onFlip,
        })
    watchers.set(account.id, watcher)
  }

  return {
    start() {
      for (const w of watchers.values()) w.start()
    },
    async stop() {
      await Promise.all(Array.from(watchers.values()).map((w) => w.stop()))
    },
    getWatchers: () => watchers,
  }
}
