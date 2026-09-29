import { describe, expect, test } from "bun:test"

import { buildItems, formatNudge, MESSAGE_LIMIT, parseHerdrTabs, planNudge, recipientKey, trackTabs } from "../lib/nudge.mjs"

const owner = { platform: "discordbot", target: "dm-owner", bot: "meow" }
const alice = { platform: "telegrambot", target: "chat-alice" }
const MIN = 60_000

function herdrOutput(tabs: Array<[string, string, string]>) {
  return JSON.stringify({
    id: "cli:tab:list",
    result: { tabs: tabs.map(([tab_id, agent_status, label]) => ({ tab_id, agent_status, label, workspace_id: "w1", number: 1, pane_count: 1, focused: false })) },
  })
}

type Recipient = { platform: string; target: string; bot?: string }
type SessionFixture = { title?: string; thread?: string; progress?: string; progressAt?: string; startedAt?: string; requester?: Recipient }
type TrackedFixture = { firstSeenAt: number; status: string; statusSince: number }

function itemsAt(output: string, now: number, sessions: Record<string, SessionFixture> = {}, previous: Record<string, TrackedFixture> = {}) {
  const tabs = parseHerdrTabs(output)
  const tracked = trackTabs(previous, tabs, now)
  return { tabs, tracked, items: buildItems({ tabs, tracked, sessions }) }
}

describe("parseHerdrTabs", () => {
  test("#given real herdr tab list JSON #when parsed #then tab id, label, and status come through", () => {
    const tabs = parseHerdrTabs(herdrOutput([["w1:t1", "working", "fix-login"]]))

    expect(tabs).toEqual([{ tabId: "w1:t1", label: "fix-login", status: "working", workspaceId: "w1" }])
  })

  test("#given output without result.tabs #when parsed #then it throws", () => {
    expect(() => parseHerdrTabs(JSON.stringify({ error: "no server" }))).toThrow("result.tabs")
  })
})

describe("buildItems", () => {
  test("#given working, blocked, and idle tabs #when built #then blocked comes first and unmapped idle tabs are dropped", () => {
    const { items } = itemsAt(herdrOutput([["t1", "working", "b-task"], ["t2", "idle", "old"], ["t3", "blocked", "a-task"]]), 0)

    expect(items.map((item: { tabId: string; kind: string }) => [item.tabId, item.kind])).toEqual([["t3", "blocked"], ["t1", "working"]])
  })

  test("#given an idle tab the skill launched #when built #then it is reported as waiting with its map details", () => {
    const sessions = { t2: { title: "Ship docs", thread: "https://chat/thread/2", startedAt: new Date(0).toISOString() } }

    const { items } = itemsAt(herdrOutput([["t2", "idle", "docs"]]), 0, sessions)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "waiting", title: "Ship docs", thread: "https://chat/thread/2" })
  })
})

describe("planNudge", () => {
  test("#given nothing working or blocked #when planned #then nothing is sent", () => {
    const sessions = { t2: { title: "Ship docs" } }
    const { items } = itemsAt(herdrOutput([["t2", "idle", "docs"], ["t4", "done", "other"]]), 0, sessions)

    const plan = planNudge({ items, owner, sent: {} })

    expect(plan.deliveries).toEqual([])
    expect(plan.reason).toBe("nothing_running")
  })

  test("#given the same tasks later with only time passing #when planned #then the repeat is suppressed", () => {
    const first = itemsAt(herdrOutput([["t1", "working", "task"]]), 0)
    const firstPlan = planNudge({ items: first.items, owner, sent: {} })
    const sent = { [recipientKey(owner)]: { fingerprint: firstPlan.deliveries[0].fingerprint } }

    const later = itemsAt(herdrOutput([["t1", "working", "task"]]), 45 * MIN, {}, first.tracked)
    const laterPlan = planNudge({ items: later.items, owner, sent })

    expect(firstPlan.deliveries).toHaveLength(1)
    expect(laterPlan.deliveries).toEqual([])
    expect(laterPlan.reason).toBe("unchanged")
  })

  test("#given a task turned blocked or reported progress #when planned #then a new nudge goes out", () => {
    const first = itemsAt(herdrOutput([["t1", "working", "task"]]), 0, { t1: { title: "T" } })
    const sent = { [recipientKey(owner)]: { fingerprint: planNudge({ items: first.items, owner, sent: {} }).deliveries[0].fingerprint } }

    const blocked = itemsAt(herdrOutput([["t1", "blocked", "task"]]), MIN, { t1: { title: "T" } }, first.tracked)
    const progressed = itemsAt(herdrOutput([["t1", "working", "task"]]), MIN, { t1: { title: "T", progress: "tests green" } }, first.tracked)

    expect(planNudge({ items: blocked.items, owner, sent }).deliveries).toHaveLength(1)
    expect(planNudge({ items: progressed.items, owner, sent }).deliveries).toHaveLength(1)
  })

  test("#given a tab renamed or given a thread link #when planned #then a new nudge goes out", () => {
    const first = itemsAt(herdrOutput([["t1", "working", "tab-3"]]), 0, { t1: { title: "T" } })
    const sent = { [recipientKey(owner)]: { fingerprint: planNudge({ items: first.items, owner, sent: {} }).deliveries[0].fingerprint } }

    const renamed = itemsAt(herdrOutput([["t1", "working", "fix-login"]]), MIN, { t1: { title: "T" } }, first.tracked)
    const linked = itemsAt(herdrOutput([["t1", "working", "tab-3"]]), MIN, { t1: { title: "T", thread: "https://chat/t/1" } }, first.tracked)

    expect(planNudge({ items: renamed.items, owner, sent }).deliveries).toHaveLength(1)
    expect(planNudge({ items: linked.items, owner, sent }).deliveries).toHaveLength(1)
  })

  test("#given a task with its own requester #when planned #then it goes to that person and the rest to the owner", () => {
    const sessions = { t1: { title: "Alice's task", requester: alice } }
    const { items } = itemsAt(herdrOutput([["t1", "working", "alice-task"], ["t2", "working", "mine"]]), 0, sessions)

    const plan = planNudge({ items, owner, sent: {} })

    const byKey = Object.fromEntries(plan.deliveries.map((delivery: { key: string; items: Array<{ tabId: string }> }) => [delivery.key, delivery.items.map((item) => item.tabId)]))
    expect(byKey).toEqual({ [recipientKey(alice)]: ["t1"], [recipientKey(owner)]: ["t2"] })
  })

  test("#given no owner and an unmapped task #when planned #then it is reported as unroutable", () => {
    const { items } = itemsAt(herdrOutput([["t1", "working", "x"]]), 0)

    const plan = planNudge({ items, owner: null, sent: {} })

    expect(plan.deliveries).toEqual([])
    expect(plan.unroutable).toEqual(["t1"])
  })
})

describe("formatNudge", () => {
  test("#given blocked and working tasks #when formatted #then the blocked task is listed before the working one", () => {
    const sessions = { t1: { title: "Port bench", progress: "ran tests", progressAt: new Date(50 * MIN).toISOString(), startedAt: new Date(0).toISOString() } }
    const first = itemsAt(herdrOutput([["t1", "working", "bench"], ["t2", "working", "desk"]]), 0, sessions)
    const now = 62 * MIN
    const { items } = itemsAt(herdrOutput([["t1", "working", "bench"], ["t2", "blocked", "desk"]]), 60 * MIN, sessions, first.tracked)

    const lines = formatNudge(items, { now, language: "en" }).split("\n")

    expect(lines[1].startsWith("⚠️ desk")).toBe(true)
    expect(lines[2].startsWith("🔄 bench")).toBe(true)
  })

  test("#given more tasks than fit #when formatted #then the message stays under the limit and counts the rest", () => {
    const tabs: Array<[string, string, string]> = Array.from({ length: 200 }, (_, index) => [`t${index}`, "working", `task-number-${index}-${"x".repeat(20)}`])
    const { items } = itemsAt(herdrOutput(tabs), 0)

    const text = formatNudge(items, { now: 0, language: "ko" })

    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    expect(text.split("\n").at(-1)?.startsWith("…")).toBe(true)
  })
})
