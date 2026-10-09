import { describe, expect, test } from "bun:test"
import { mkdtempSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import {
  claimedProviders,
  claimProviders,
  mergeUsageResults,
  providersDue,
  sanitizeUsageCache,
  usageCachePath,
  writeUsageCache,
} from "./cache"
import type { PanelUsageCacheFile } from "./types"

const NOW = 1_700_000_000_000
const POLL_MS = 150_000
const CLAIM_TOKEN = "claim-a"
const target = { key: "claude", account: "work", pollMs: POLL_MS } as const

describe("providersDue", () => {
  test("#given numbers younger than the interval #when asked #then no request is spent", () => {
    // given
    const cache: PanelUsageCacheFile = { claude: { account: "work", updatedAt: NOW - 10_000 } }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual([])
  })

  test("#given the cached numbers belong to another account #when asked #then it refetches at once", () => {
    // given the credential pool failed over, so the cached quota is somebody else's
    const cache: PanelUsageCacheFile = { claude: { account: "personal", updatedAt: NOW - 1_000 } }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual(["claude"])
  })

  test("#given a shared backoff that has not expired #when asked #then it stays quiet", () => {
    // given
    const cache: PanelUsageCacheFile = { claude: { account: "work", updatedAt: NOW - 10 * POLL_MS, retryAt: NOW + 60_000 } }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual([])
  })

  test("#given a sibling session announced the same fetch #when asked #then it does not stampede", () => {
    // given
    const cache: PanelUsageCacheFile = {
      claude: { account: "work", updatedAt: NOW - 10 * POLL_MS },
      fetching: { claude: { claimedAt: NOW - 5_000, account: "work", token: "sibling" } },
    }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual([])
  })

  test("#given another account is being fetched #when asked #then the serving account refetches immediately", () => {
    // given
    const cache: PanelUsageCacheFile = {
      claude: { account: "personal", updatedAt: NOW - 10 * POLL_MS },
      fetching: { claude: { claimedAt: NOW - 5_000, account: "personal", token: "sibling" } },
    }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual(["claude"])
  })

  test("#given the announcement is older than the claim window #when asked #then the fetch is retried", () => {
    // given a session that died mid-fetch must not silence the others forever
    const cache: PanelUsageCacheFile = {
      claude: { account: "work", updatedAt: NOW - 10 * POLL_MS },
      fetching: { claude: { claimedAt: NOW - 120_000, account: "work", token: "sibling" } },
    }

    // when / then
    expect(providersDue(cache, [target], NOW)).toEqual(["claude"])
  })
})

describe("claimProviders", () => {
  test("#given a due provider #when claimed #then the announcement is stamped and entries survive", () => {
    // given
    const cache: PanelUsageCacheFile = { claude: { account: "work", updatedAt: NOW - POLL_MS } }

    // when
    const next = claimProviders(cache, [target], NOW, CLAIM_TOKEN)

    // then
    expect(next.fetching?.claude).toEqual({ claimedAt: NOW, account: "work", token: CLAIM_TOKEN })
    expect(next.claude?.updatedAt).toBe(NOW - POLL_MS)
  })

  test("#given a sibling overwrites our claim #when ownership is checked #then no provider is fetched", () => {
    // given
    const cache: PanelUsageCacheFile = {
      fetching: { claude: { claimedAt: NOW, account: "work", token: "sibling" } },
    }

    // when / then
    expect(claimedProviders(cache, [target], CLAIM_TOKEN)).toEqual([])
  })
})

describe("mergeUsageResults", () => {
  test("#given a failure after a good read #when merged #then the bars stay and the error joins them", () => {
    // given
    const cache: PanelUsageCacheFile = {
      claude: { account: "work", updatedAt: NOW - POLL_MS, windows: [{ label: "5h", percent: 40 }] },
      fetching: { claude: { claimedAt: NOW, account: "work", token: CLAIM_TOKEN } },
    }

    // when
    const next = mergeUsageResults(
      cache,
      [{ key: "claude", entry: { account: "work", error: "rate limited", retryAt: NOW + 60_000 } }],
      ["claude"],
      CLAIM_TOKEN,
    )

    // then
    expect(next.claude?.windows).toEqual([{ label: "5h", percent: 40 }])
    expect(next.claude?.error).toBe("rate limited")
    expect(next.claude?.retryAt).toBe(NOW + 60_000)
    expect(next.fetching?.claude).toBeUndefined()
  })

  test("#given a failure with nothing cached #when merged #then the error stands alone", () => {
    // given
    const cache: PanelUsageCacheFile = {
      fetching: { codex: { claimedAt: NOW, token: CLAIM_TOKEN } },
    }

    // when
    const next = mergeUsageResults(cache, [{ key: "codex", entry: { error: "timed out" } }], ["codex"], CLAIM_TOKEN)

    // then
    expect(next.codex).toEqual({ error: "timed out" })
  })

  test("#given a fresh read #when merged #then it replaces the previous entry outright", () => {
    // given
    const cache: PanelUsageCacheFile = { claude: { account: "work", error: "timed out", windows: [{ label: "5h", percent: 40 }] } }
    const entry = { account: "work", updatedAt: NOW, windows: [{ label: "5h", percent: 41 }] }

    // when
    const next = mergeUsageResults(
      { ...cache, fetching: { claude: { claimedAt: NOW, account: "work", token: CLAIM_TOKEN } } },
      [{ key: "claude", entry }],
      ["claude"],
      CLAIM_TOKEN,
    )

    // then
    expect(next.claude).toEqual(entry)
  })

  test("#given a failure belongs to a different account #when merged #then old quota bars are dropped", () => {
    // given
    const cache: PanelUsageCacheFile = {
      claude: { account: "work", updatedAt: NOW, windows: [{ label: "5h", percent: 42 }] },
      fetching: { claude: { claimedAt: NOW, account: "personal", token: CLAIM_TOKEN } },
    }
    const entry = {
      account: "personal",
      pinnedAccount: "work",
      accountState: "ok",
      error: "HTTP 503",
      retryAt: NOW + 60_000,
    } as const

    // when
    const next = mergeUsageResults(cache, [{ key: "claude", entry }], ["claude"], CLAIM_TOKEN)

    // then
    expect(next.claude).toEqual(entry)
  })

  test("#given our claim was replaced #when results return #then the sibling claim and cache survive", () => {
    // given
    const cache: PanelUsageCacheFile = {
      claude: { account: "work", updatedAt: NOW, windows: [{ label: "5h", percent: 42 }] },
      fetching: { claude: { claimedAt: NOW, account: "work", token: "sibling" } },
    }

    // when
    const next = mergeUsageResults(
      cache,
      [{ key: "claude", entry: { account: "work", updatedAt: NOW - 1, windows: [{ label: "5h", percent: 41 }] } }],
      ["claude"],
      CLAIM_TOKEN,
    )

    // then
    expect(next.claude?.windows?.[0]?.percent).toBe(42)
    expect(next.fetching?.claude?.token).toBe("sibling")
  })
})

describe("sanitizeUsageCache", () => {
  test("#given a file written by another version #when read #then unreadable parts are dropped", () => {
    // given the cache is shared between sessions and versions, so it is validated, not trusted
    const parsed = {
      claude: {
        account: "work",
        accountState: "sideways",
        updatedAt: NOW,
        windows: [{ label: "5h", percent: 40, resetsAt: NOW + 1_000 }, { label: "broken" }, "nonsense"],
      },
      codex: 7,
      fetching: { claude: "soon" },
    }

    // when
    const cache = sanitizeUsageCache(parsed)

    // then
    expect(cache.claude?.windows).toEqual([{ label: "5h", percent: 40, resetsAt: NOW + 1_000 }])
    expect(cache.claude?.accountState).toBeUndefined()
    expect(cache.codex).toBeUndefined()
    expect(cache.fetching).toEqual({})
  })

  test("#given anything that is not an object #when read #then the cache is empty", () => {
    // given / when / then
    expect(sanitizeUsageCache("[]")).toEqual({})
  })

  test("#given every supplied window is invalid #when read #then freshness is dropped for an immediate refetch", () => {
    // given
    const parsed = {
      claude: {
        account: "work",
        updatedAt: NOW,
        windows: [{ label: "broken" }],
      },
    }

    // when
    const cache = sanitizeUsageCache(parsed)

    // then
    expect(cache.claude?.windows).toBeUndefined()
    expect(cache.claude?.updatedAt).toBeUndefined()
  })
})

describe("usageCachePath", () => {
  test("#given an empty XDG cache home #when resolved #then the home cache fallback is used", () => {
    // given / when / then
    expect(usageCachePath({ XDG_CACHE_HOME: "" })).toBe(join(homedir(), ".cache", "omo-senpi", "side-panel-usage.json"))
  })
})

describe("writeUsageCache permissions", () => {
  test.skipIf(process.platform === "win32")("#given a cache write #when it lands #then only the owner can read it", () => {
    // given
    const path = join(mkdtempSync(join(tmpdir(), "omo-usage-")), "usage.json")

    // when
    const written = writeUsageCache(path, {})

    // then
    expect(written).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
