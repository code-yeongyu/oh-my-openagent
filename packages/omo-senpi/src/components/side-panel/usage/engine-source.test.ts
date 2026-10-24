import { describe, expect, test } from "bun:test"

import type { SenpiAccountLimits } from "../../../extension/types"
import type { UsageCredentialSource } from "./credentials"
import { createEngineUsageSource, type EngineLimits } from "./engine-source"

const NOW = Date.parse("2026-10-19T04:00:00Z")
const token = (tag: string): string => `${tag}-${"t".repeat(48)}`

function claudeAuth(pinned: string, names: readonly string[]): UsageCredentialSource {
  return {
    auth: {
      "anthropic-subscription": {
        type: "oauth",
        pinned,
        accounts: names.map((name) => ({ name, access: token(name), refresh: token(`r-${name}`), expires: NOW + 3_600_000 })),
      },
    },
    pool: undefined,
  }
}

function record(account: string, usedPercent: number, extra: Partial<SenpiAccountLimits> = {}): SenpiAccountLimits {
  return {
    provider: "anthropic-subscription",
    account,
    windows: [
      { id: "claude:5h", label: "5h", windowMinutes: 300, usedPercent, resetsAt: "2026-10-19T09:00:00.000Z" },
      { id: "claude:7d_opus", label: "7d opus", windowMinutes: 10080, usedPercent: 3 },
    ],
    reportedAt: "2026-10-19T03:59:00.000Z",
    ...extra,
  }
}

function engine(initial: readonly SenpiAccountLimits[]): EngineLimits & { set(next: readonly SenpiAccountLimits[]): void; listeners: number } {
  let records = initial
  const listeners = new Set<() => void>()
  return {
    get: () => records,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      records = next
      for (const listener of listeners) listener()
    },
    get listeners() {
      return listeners.size
    },
  }
}

describe("createEngineUsageSource", () => {
  test("#given engine records for two accounts #when the panel reads #then it draws the serving account's record", () => {
    const limits = engine([record("work", 41), record("home", 90)])
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth("work", ["work", "home"]), now: () => NOW, onChange: () => {} })

    expect(source.snapshot()).toEqual({
      claude: {
        account: "work",
        accountState: "ok",
        updatedAt: Date.parse("2026-10-19T03:59:00.000Z"),
        windows: [
          { label: "5h", percent: 41, resetsAt: Date.parse("2026-10-19T09:00:00.000Z"), windowMs: 300 * 60_000 },
          { label: "7d opus", percent: 3, windowMs: 10080 * 60_000, scoped: true },
        ],
      },
    })
  })

  test("#given a new report from the engine #when it lands #then the snapshot follows and the panel repaints", () => {
    const limits = engine([])
    let repaints = 0
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth("work", ["work"]), now: () => NOW, onChange: () => (repaints += 1) })
    expect(source.snapshot()).toEqual({})

    limits.set([record("work", 12, { error: "rate limited" })])

    expect(source.snapshot().claude).toMatchObject({ error: "rate limited", windows: [{ percent: 12 }, { percent: 3 }] })
    expect(repaints).toBe(2)
  })

  test("#given no stored login (an env or ambient account) #when the engine reported one #then that record is drawn", () => {
    const limits = engine([record("env", 55, { reportedAt: "2026-10-19T03:00:00.000Z" }), record("ambient", 20)])
    const source = createEngineUsageSource({ limits, readCredentials: () => ({ auth: {}, pool: undefined }), now: () => NOW, onChange: () => {} })

    expect(source.snapshot().claude).toMatchObject({ account: "ambient", windows: [{ percent: 20 }, { percent: 3 }] })
    expect(source.snapshot().claude?.accountState).toBeUndefined()
  })

  test("#given a stored login but the engine serves through an env token #when only the env record exists #then the env record is drawn", () => {
    const limits = engine([record("env", 55)])
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth("work", ["work"]), now: () => NOW, onChange: () => {} })

    expect(source.snapshot().claude?.windows?.[0]?.percent).toBe(55)
  })

  test("#given a stored login with its own record and an env record #when the panel reads #then the stored login's record wins", () => {
    const limits = engine([record("env", 55), record("work", 41)])
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth("work", ["work"]), now: () => NOW, onChange: () => {} })

    expect(source.snapshot().claude?.windows?.[0]?.percent).toBe(41)
  })

  test("#given the pool rotated #when the turn refreshes #then the new serving account's record is drawn, and stop unsubscribes", () => {
    const limits = engine([record("work", 41), record("home", 7)])
    let pinned = "work"
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth(pinned, ["work", "home"]), now: () => NOW, onChange: () => {} })
    pinned = "home"
    source.refresh()

    expect(source.snapshot().claude?.account).toBe("home")
    source.stop()
    expect(limits.listeners).toBe(0)
  })

  test("#given the pool rotated to an account the engine has not read yet #when the turn refreshes #then the old account's numbers are not shown", () => {
    const limits = engine([record("work", 41)])
    let pinned = "work"
    const source = createEngineUsageSource({ limits, readCredentials: () => claudeAuth(pinned, ["work", "home"]), now: () => NOW, onChange: () => {} })
    pinned = "home"
    source.refresh()

    expect(source.snapshot().claude).toBeUndefined()
    source.stop()
    expect(limits.listeners).toBe(0)
  })
})
