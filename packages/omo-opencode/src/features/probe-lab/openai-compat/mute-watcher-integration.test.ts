import { describe, expect, test } from "bun:test"
import type { MuteWatcher } from "../experiments/rate-limit-mute-watcher"
import type { MuteState } from "../experiments/rate-limit-types"
import { createAccountPool } from "./account-pool"
import { createPoolMuteWatchers } from "./mute-watcher-integration"
import type { PoolAccount } from "./pool-types"
import { createTelemetry } from "./telemetry"

function fakeAccount(id: string): PoolAccount {
  return {
    id,
    provider: {} as PoolAccount["provider"],
    baseUrl: "https://chat.deepseek.com",
    creds: {} as PoolAccount["creds"],
  }
}

type FakeWatcher = MuteWatcher & {
  triggerFlip: (s: MuteState) => void
  startCount: () => number
  stopCount: () => number
}

function makeFakeWatcher(onFlip: (s: MuteState) => void): FakeWatcher {
  let starts = 0
  let stops = 0
  return {
    start: () => {
      starts++
    },
    stop: async () => {
      stops++
    },
    getLast: () => null,
    hasMutedSinceStart: () => false,
    getSamples: () => [],
    triggerFlip: (s) => onFlip(s),
    startCount: () => starts,
    stopCount: () => stops,
  }
}

describe("createPoolMuteWatchers", () => {
  describe("#given a 2-account pool #when watchers started + stopped #then each account has a watcher and start/stop fire", () => {
    test("watcher lifecycle", async () => {
      const pool = createAccountPool({
        accounts: [fakeAccount("a"), fakeAccount("b")],
      })
      const created: FakeWatcher[] = []
      const set = createPoolMuteWatchers({
        pool,
        watcherFactory: ({ onFlip }) => {
          const w = makeFakeWatcher(onFlip)
          created.push(w)
          return w
        },
      })
      set.start()
      expect(created).toHaveLength(2)
      expect(created.every((w) => w.startCount() === 1)).toBe(true)
      await set.stop()
      expect(created.every((w) => w.stopCount() === 1)).toBe(true)
      pool.shutdown()
    })
  })

  describe("#given a watcher fires onFlip(muted) #when triggered #then pool marks the account muted, triggers cooldown, and telemetry records mute_observed", () => {
    test("onFlip handler effects", async () => {
      const pool = createAccountPool({
        accounts: [fakeAccount("a"), fakeAccount("b")],
      })
      const telemetry = createTelemetry()
      const created: FakeWatcher[] = []
      const set = createPoolMuteWatchers({
        pool,
        telemetry,
        watcherFactory: ({ onFlip }) => {
          const w = makeFakeWatcher(onFlip)
          created.push(w)
          return w
        },
      })
      set.start()
      const aWatcher = created[0]!
      aWatcher.triggerFlip({
        is_muted: 1,
        mute_until: Date.now() + 60_000,
        sampled_at: Date.now(),
        raw_status: 200,
        raw_body_preview: "",
      })
      const aState = pool.getState("a")!
      expect(aState.is_muted).toBe(true)
      expect(aState.cooldown_until).toBeGreaterThan(Date.now())
      const snap = telemetry.snapshot()
      const aSnap = snap.per_account.find((p) => p.account_id === "a")!
      expect(aSnap.counters.mute_observed).toBe(1)
      const ids: string[] = []
      for (let i = 0; i < 4; i++) {
        const r = await pool.acquire()
        ids.push(r.account.id)
        r.release()
      }
      expect(ids.every((id) => id === "b")).toBe(true)
      await set.stop()
      pool.shutdown()
    })
  })
})
