import { describe, expect, test } from "bun:test"

import type { PanelUsageSnapshot } from "../usage/types"
import { buildUsageRows } from "./usage"

const NOW = 1_700_000_000_000
const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildUsageRows", () => {
  test("#given one provider #when built #then a bar row per window carries its percent", () => {
    // given
    const usage: PanelUsageSnapshot = {
      claude: {
        account: "work",
        accountState: "ok",
        updatedAt: NOW - 60_000,
        windows: [
          { label: "5h", percent: 38, windowMs: 5 * 60 * 60 * 1_000, resetsAt: NOW + 2 * 60 * 60 * 1_000 },
          { label: "7d", percent: 12 },
        ],
      },
    }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    expect(rows[0]?.text.startsWith("USAGE  ")).toBe(true)
    expect(rows[0]?.text.endsWith("ago")).toBe(true)
    expect(rows[1]?.text.startsWith("5h")).toBe(true)
    expect(rows[1]?.text).toContain(" 38%")
    // A window that rolls today is counted down rather than dated.
    expect(rows[1]?.text).toContain("2h00")
    expect(rows[2]?.text).toContain(" 12%")
    expect(texts(rows)).toContain("account work")
  })

  test("#given both providers #when built #then each block is named", () => {
    // given
    const usage: PanelUsageSnapshot = {
      claude: { updatedAt: NOW, windows: [{ label: "5h", percent: 10 }] },
      codex: { updatedAt: NOW, windows: [{ label: "5h", percent: 20 }] },
    }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    expect(texts(rows)).toContain("claude")
    expect(texts(rows)).toContain("codex")
  })

  test("#given a single provider #when built #then its name is not repeated as a label", () => {
    // given
    const usage: PanelUsageSnapshot = { codex: { updatedAt: NOW, windows: [{ label: "5h", percent: 20 }] } }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    expect(texts(rows)).not.toContain("codex")
  })

  test("#given a failure on top of known numbers #when built #then the bars stay and the error is quiet", () => {
    // given
    const usage: PanelUsageSnapshot = {
      claude: { updatedAt: NOW - 60_000, windows: [{ label: "5h", percent: 38 }], error: "rate limited", retryAt: NOW + 300_000 },
    }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    const error = rows.find((row) => row.text.startsWith("rate limited"))
    expect(error?.text).toBe("rate limited · retry 5m")
    expect(error?.color).toBe("dim")
    expect(rows.some((row) => row.text.includes("38%"))).toBe(true)
  })

  test("#given a failure with nothing cached #when built #then the error is the warning it is", () => {
    // given
    const usage: PanelUsageSnapshot = { claude: { error: "auth stale - run /login" } }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    expect(rows[1]?.color).toBe("warning")
    expect(rows[1]?.text).toBe("auth stale - run /login")
  })

  test("#given the pool failed over #when built #then the row says whose quota is on screen", () => {
    // given
    const usage: PanelUsageSnapshot = {
      claude: { updatedAt: NOW, account: "personal", pinnedAccount: "work", accountState: "ok", windows: [{ label: "5h", percent: 5 }] },
    }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    const account = rows.find((row) => row.text.startsWith("account"))
    expect(account?.text).toBe("account personal (failover from work)")
    expect(account?.color).toBe("warning")
  })

  test("#given a window that is nearly spent #when built #then the row is a warning", () => {
    // given
    const usage: PanelUsageSnapshot = { claude: { updatedAt: NOW, windows: [{ label: "5h", percent: 94 }] } }

    // when
    const rows = buildUsageRows(usage, NOW, 40)

    // then
    expect(rows[1]?.color).toBe("warning")
  })

  test("#given reset labels of different lengths #when built #then every bar keeps one width", () => {
    // given a countdown next to a weekday clock, which is what made the right edge ragged
    const usage: PanelUsageSnapshot = {
      claude: {
        updatedAt: NOW,
        windows: [
          { label: "5h", percent: 65, resetsAt: NOW + 2 * 60 * 60 * 1_000 },
          { label: "7d", percent: 16, resetsAt: NOW + 3 * 24 * 60 * 60 * 1_000 },
        ],
      },
    }

    // when
    const rows = buildUsageRows(usage, NOW, 44)

    // then the percentages sit in one column, which is the whole point of a column
    const columns = rows.filter((row) => row.text.includes("%")).map((row) => row.text.indexOf("%"))
    expect(columns).toHaveLength(2)
    expect(new Set(columns).size).toBe(1)
  })

  test("#given nothing has been fetched #when built #then the section stays silent", () => {
    // given / when / then
    expect(buildUsageRows({}, NOW, 40)).toEqual([])
  })
})
