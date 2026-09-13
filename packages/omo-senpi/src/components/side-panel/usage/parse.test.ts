import { describe, expect, test } from "bun:test"

import { codexAccountId, parseClaudeUsage, parseCodexUsage } from "./parse"

const NOW = 1_700_000_000_000
const FIVE_HOURS = 5 * 60 * 60 * 1_000
const WEEK = 7 * 24 * 60 * 60 * 1_000

describe("parseClaudeUsage", () => {
  test("#given the limits array #when parsed #then each kind becomes a labelled window", () => {
    // given
    const payload = {
      limits: [
        { kind: "session", percent: 38.2, resets_at: "2023-11-14T22:00:00Z" },
        { kind: "weekly_all", percent: 12, resets_at: "2023-11-20T00:00:00Z" },
      ],
    }

    // when
    const entry = parseClaudeUsage(payload, NOW)

    // then
    expect(entry.windows).toEqual([
      { label: "5h", percent: 38.2, windowMs: FIVE_HOURS, resetsAt: Date.parse("2023-11-14T22:00:00Z") },
      { label: "7d", percent: 12, windowMs: WEEK, resetsAt: Date.parse("2023-11-20T00:00:00Z") },
    ])
    expect(entry.updatedAt).toBe(NOW)
  })

  test("#given a weekly limit scoped to one model #when parsed #then the model names the row", () => {
    // given
    const payload = {
      limits: [{ kind: "weekly_scoped", percent: 61, scope: { model: { display_name: "Opus 4.6" } } }],
    }

    // when
    const entry = parseClaudeUsage(payload, NOW)

    // then
    expect(entry.windows).toEqual([{ label: "Opus 4.6", percent: 61, windowMs: WEEK, scoped: true }])
  })

  test("#given only the legacy pair #when parsed #then it is read as a fallback", () => {
    // given the older payload shape, which carries utilization instead of percent
    const payload = { five_hour: { utilization: 44, resets_at: "2023-11-14T22:00:00Z" }, seven_day: { utilization: 9 } }

    // when
    const entry = parseClaudeUsage(payload, NOW)

    // then
    expect(entry.windows?.map((window) => [window.label, window.percent])).toEqual([
      ["5h", 44],
      ["7d", 9],
    ])
  })

  test("#given limits that carry no numbers #when parsed #then no window is invented", () => {
    // given
    const payload = { limits: [{ kind: "session", resets_at: "2023-11-14T22:00:00Z" }] }

    // when
    const entry = parseClaudeUsage(payload, NOW)

    // then
    expect(entry.windows).toEqual([])
  })

  test("#given a payload that is not an object #when parsed #then it degrades instead of throwing", () => {
    // given / when
    const entry = parseClaudeUsage("nope", NOW)

    // then
    expect(entry.windows).toEqual([])
  })
})

describe("parseCodexUsage", () => {
  test("#given both windows #when parsed #then the label comes from the window length", () => {
    // given
    const payload = {
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 21.4, limit_window_seconds: 18_000, reset_at: 1_700_001_000 },
        secondary_window: { used_percent: 5, limit_window_seconds: 604_800 },
      },
    }

    // when
    const entry = parseCodexUsage(payload, NOW)

    // then
    expect(entry.plan).toBe("pro")
    expect(entry.windows).toEqual([
      { label: "5h", percent: 21.4, windowMs: FIVE_HOURS, resetsAt: 1_700_001_000_000 },
      { label: "7d", percent: 5, windowMs: WEEK },
    ])
  })

  test("#given a window of an unfamiliar length #when parsed #then the label states its hours", () => {
    // given
    const payload = { rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 7_200 } } }

    // when
    const entry = parseCodexUsage(payload, NOW)

    // then
    expect(entry.windows?.[0]?.label).toBe("2h")
  })
})

describe("codexAccountId", () => {
  test("#given a token carrying the auth claim #when decoded #then the account id comes back", () => {
    // given
    const token = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-42" } })

    // when / then
    expect(codexAccountId(token)).toBe("acct-42")
  })

  test("#given a token that is not a jwt #when decoded #then nothing comes back", () => {
    // given / when / then
    expect(codexAccountId("not-a-token")).toBeUndefined()
  })
})

function jwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `header.${payload}.signature`
}
