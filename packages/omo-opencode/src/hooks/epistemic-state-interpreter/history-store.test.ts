import { afterEach, describe, expect, test } from "bun:test"
import type { ConclusionHistory, HistoryEntry } from "./transition-types"
import { _resetForTesting, clearHistory, getHistory, hydrate, isHydrated, snapshot, updateHistory } from "./history-store"
import type { EpistemicState } from "./types"

const sessionID = "session-1"
const conclusion = "claim-a"

function entry(classification: EpistemicState, callID: string, timestamp: number): HistoryEntry {
  return { classification, callID, timestamp }
}

function history(state: EpistemicState, entries: HistoryEntry[], consecutiveCount: number): ConclusionHistory {
  return {
    currentState: state,
    entries,
    consecutiveCount,
    lastClassification: entries.at(-1)?.classification ?? state,
    lastSeenInvocation: 0,
    exclusionTheoryHash: undefined,
  }
}

afterEach(() => {
  _resetForTesting()
})

describe("history-store #given empty store", () => {
  test("#when storing a single conclusion #then getHistory returns correct data", () => {
    updateHistory(sessionID, conclusion, entry("plausible", "c1", 1), "plausible")

    expect(getHistory(sessionID, conclusion)).toEqual(history("plausible", [entry("plausible", "c1", 1)], 1))
  })

  test("#when storing two different conclusions #then they do not interfere", () => {
    updateHistory(sessionID, "claim-a", entry("open", "c1", 1), "open")
    updateHistory(sessionID, "claim-b", entry("accepted", "c2", 2), "accepted")

    expect(getHistory(sessionID, "claim-a")).toEqual(history("open", [entry("open", "c1", 1)], 1))
    expect(getHistory(sessionID, "claim-b")).toEqual(history("accepted", [entry("accepted", "c2", 2)], 1))
  })
})

describe("history-store #given an existing conclusion", () => {
  test("#when the second entry has the same classification #then consecutiveCount becomes 2", () => {
    updateHistory(sessionID, conclusion, entry("open", "c1", 1), "open")
    updateHistory(sessionID, conclusion, entry("open", "c2", 2), "plausible")

    expect(getHistory(sessionID, conclusion)?.consecutiveCount).toBe(2)
  })

  test("#when the second entry has a different classification #then consecutiveCount resets to 1", () => {
    updateHistory(sessionID, conclusion, entry("open", "c1", 1), "open")
    updateHistory(sessionID, conclusion, entry("accepted", "c2", 2), "accepted")

    expect(getHistory(sessionID, conclusion)?.consecutiveCount).toBe(1)
  })

  test("#when a third entry matches the latest classification #then consecutiveCount becomes 3", () => {
    updateHistory(sessionID, conclusion, entry("open", "c1", 1), "open")
    updateHistory(sessionID, conclusion, entry("open", "c2", 2), "open")
    updateHistory(sessionID, conclusion, entry("open", "c3", 3), "open")

    expect(getHistory(sessionID, conclusion)?.consecutiveCount).toBe(3)
  })
})

describe("history-store #given hydrated data", () => {
  test("#when hydrate is called #then isHydrated returns true", () => {
    hydrate(sessionID, {
      [conclusion]: history("accepted", [entry("accepted", "c1", 1)], 1),
    })

    expect(isHydrated(sessionID)).toBe(true)
  })

  test("#when hydrate is called #then getHistory returns hydrated data", () => {
    const expected = history("accepted", [entry("accepted", "c1", 1)], 1)
    hydrate(sessionID, { [conclusion]: expected })

    expect(getHistory(sessionID, conclusion)).toEqual(expected)
  })

  test("#when hydrate then snapshot are called #then the data round-trips", () => {
    const expected = {
      [conclusion]: history("plausible", [entry("plausible", "c1", 1)], 1),
      "claim-b": history("open", [entry("open", "c2", 2)], 1),
    }

    hydrate(sessionID, expected)

    expect(snapshot(sessionID)).toEqual(expected)
  })
})

describe("history-store #given cleanup operations", () => {
  test("#when clearHistory is called #then session data and hydration state are removed", () => {
    hydrate(sessionID, {
      [conclusion]: history("accepted", [entry("accepted", "c1", 1)], 1),
    })

    clearHistory(sessionID)

    expect(getHistory(sessionID, conclusion)).toBeUndefined()
    expect(isHydrated(sessionID)).toBe(false)
  })

  test("#when _resetForTesting is called #then all state is cleared", () => {
    updateHistory(sessionID, conclusion, entry("open", "c1", 1), "open")
    hydrate("session-2", {
      [conclusion]: history("accepted", [entry("accepted", "c2", 2)], 1),
    })

    _resetForTesting()

    expect(getHistory(sessionID, conclusion)).toBeUndefined()
    expect(getHistory("session-2", conclusion)).toBeUndefined()
    expect(isHydrated("session-2")).toBe(false)
  })
})

describe("history-store #given many conclusions", () => {
  test("#when 100 unique conclusions are stored #then each remains accessible", () => {
    for (let index = 0; index < 100; index += 1) {
      const key = `claim-${index}`
      updateHistory(sessionID, key, entry("plausible", `c${index}`, index), "plausible")
    }

    for (let index = 0; index < 100; index += 1) {
      const key = `claim-${index}`
      expect(getHistory(sessionID, key)?.entries[0]).toEqual(entry("plausible", `c${index}`, index))
    }
  })
})
