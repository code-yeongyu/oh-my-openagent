// Presentation tests for the memory transcript entries.
//
// The entry family mirrors senpi's own notice box (notice/box.ts +
// goal/cache-warm-renderer.ts): a BOLD tone-coloured title, a dim forward-looking
// "why" line, a visible quantitative "extra" line in a semantic tone, and a dim
// expanded-only detail line. Expectations here are LITERAL strings. They are
// deliberately NOT re-derived from the constants/helpers the renderers use: a
// tautological expectation would keep a corrupted glyph/colour table green.
import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"
import { visibleWidth } from "@earendil-works/pi-tui"

import { renderReflectionCompletionEntry, type ReflectionCompletionRecord } from "./completion"
import { renderReflectionHealthEntry, type ReflectionHealthEntry } from "./health-alert"

/** Senpi notice titles are bold; box.ts wraps the title in raw SGR bold on/off. */
const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

/** Marks colour/emphasis inline so assertions can see exactly what was applied. */
const TAGGING_THEME = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
  bg: (_color: "customMessageBg", text: string) => text,
}

/** Plain theme: passes text through so we can assert layout without colour noise. */
const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

/** Records every fg/italic call so we can prove semantic colour is actually applied. */
function recordingTheme(): {
  readonly theme: { fg: (color: ThemeColor, text: string) => string; bg: (color: "customMessageBg", text: string) => string }
  readonly colors: ThemeColor[]
} {
  const colors: ThemeColor[] = []
  return {
    theme: {
      fg: (color: ThemeColor, text: string) => {
        colors.push(color)
        return text
      },
      bg: (_color: "customMessageBg", text: string) => text,
    },
    colors,
  }
}

const WIDE = 120
const BACKGROUND_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => `<notice-bg>${text}</notice-bg>`,
}

function expectNoticeBackground(lines: readonly string[]): void {
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) expect(line).toMatch(/^<notice-bg>.*<\/notice-bg>$/u)
}

function completion(over: Partial<ReflectionCompletionRecord> = {}): ReflectionCompletionRecord {
  return {
    schemaVersion: 1,
    runId: "reflection-run-2",
    identity: "project-a1b2c3d4",
    category: "quick",
    conversationIds: ["conversation-a"],
    trigger: "step-count",
    outcome: "merged",
    startedAt: "2026-08-13T09:00:00.000Z",
    finishedAt: "2026-08-13T09:01:12.000Z",
    delivery: { status: "consumed" },
    ...over,
  }
}

function render(
  renderer: (entry: never, options: { expanded: boolean }, theme: never) => { render(width: number): string[] } | undefined,
  data: unknown,
  options: { width?: number; expanded?: boolean; theme?: unknown } = {},
): string[] {
  const component = renderer(
    { data } as never,
    { expanded: options.expanded ?? false },
    (options.theme ?? PLAIN_THEME) as never,
  )
  expect(component).toBeDefined()
  return noticeContent(component!.render(options.width ?? WIDE))
}

function noticeContent(lines: readonly string[]): string[] {
  return lines.slice(1, -1).map((line) => line.slice(1).trimEnd())
}

describe("memory reflection entry rendering", () => {
  test("#given a persisted enriched entry #when expanded #then multiline report and historical attribution render within the terminal", () => {
    const data = { ...completion(), recap: {
      schemaVersion: 1, key: "synthetic", identity: "project-a1b2c3d4", runId: "reflection-run-2",
      startedAt: "2026-08-13T09:00:00.000Z", finishedAt: "2026-08-13T09:01:12.000Z",
      conversationIds: ["conversation-a", "conversation-b"], mergedCommitSha: "a".repeat(40),
      filesChanged: 1, changedPaths: ["reference/synthetic.md"],
      report: { status: "available", text: "# RECAP_SENTINEL\n한국어\n- detail\nEXPANDED_ONLY\n", preview: "# RECAP_SENTINEL\n한국어\n- detail", sourceTruncated: true },
    } }
    const compact = render(renderReflectionCompletionEntry, data).join("\n")
    expect(compact).toContain("RECAP_SENTINEL")
    expect(compact).not.toContain("EXPANDED_ONLY")
    const expanded = render(renderReflectionCompletionEntry, data, { expanded: true, width: 60 })
    expect(expanded.join("\n")).not.toContain("EXPANDED_ONLY")
    expect(expanded.join("\n")).toContain("reference/synthetic.md")
    expect(expanded.join("\n")).toContain("conversation-b")
    for (const line of expanded) expect(visibleWidth(line)).toBeLessThanOrEqual(60)
    expect(renderReflectionCompletionEntry({ data: { ...data, outcome: "failed" } } as never, { expanded: false }, PLAIN_THEME as never)).toBeUndefined()
  })
  test("#given every registered memory notice renderer #when rendered #then each emits a custom-message background block", () => {
    const cases = [
      renderReflectionCompletionEntry({ data: completion() } as never, { expanded: false }, BACKGROUND_THEME as never),
      renderReflectionHealthEntry({ data: {
        schemaVersion: 1, identity: "project-a1b2c3d4", streak: 3, fingerprint: "child_exit:stable",
        lastReason: "child_exit", sinceISO: "2026-08-12T22:15:00.000Z", recommendation: "Retry reflection.",
      } } as never, { expanded: false }, BACKGROUND_THEME as never),
    ]
    for (const component of cases) expectNoticeBackground(component!.render(WIDE))
  })
  describe("#given a completed reflection", () => {
    test("#when the outcome merged #then it reads as a remembered notice in the memory accent", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("● Remembered · on reflection"),
        "Kept what this session taught.",
      ])
      expect(recorder.colors).toEqual(["accent", "dim"])
    })

    test("#when merge metadata is present #then the stats line is visible and dim", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ filesChanged: 3, mergedCommitSha: "9f2c1ab7d3e4f5a6", durationMs: 72_000 }),
        { theme: recorder.theme },
      )

      // then
      expect(lines).toEqual([
        bold("● Remembered · on reflection"),
        "Kept what this session taught.",
        "3 files changed · commit 9f2c1ab",
      ])
      expect(recorder.colors).toEqual(["accent", "dim", "dim"])
    })

    test("#when merge metadata is present and expanded #then the detail row names the source conversation", () => {
      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ filesChanged: 3, mergedCommitSha: "9f2c1ab7d3e4f5a6", durationMs: 72_000 }),
        { expanded: true },
      )

      // then
      expect(lines[3]).toBe("from conversation-a")
    })

    test("#when the report opens with the persona's summary item #then its first sentence is the why line", () => {
      // given
      const data = { ...completion(), recap: {
        schemaVersion: 1, key: "synthetic", identity: "project-a1b2c3d4", runId: "reflection-run-2",
        startedAt: "2026-08-13T09:00:00.000Z", finishedAt: "2026-08-13T09:01:12.000Z",
        conversationIds: ["conversation-a"], mergedCommitSha: "616af1ae9ca8b00bfbff798cff48047f79bc0c4a",
        filesChanged: 1, changedPaths: ["reference/tooling/staged-deletion-gates.md"],
        report: {
          status: "available",
          text: "1. **Summary**: Reviewed the captured step-count transcript for the browser-guidance migration. The durable learning was a verification pattern.\n2. **Memory changes**:\n   - Created `reference/tooling/staged-deletion-gates.md`\n",
          preview: "1. **Summary**: Reviewed the captured step-count transcript",
          sourceTruncated: false,
        },
      } }

      // when
      const lines = render(renderReflectionCompletionEntry, data, { expanded: true })

      // then
      expect(lines).toEqual([
        bold("● Remembered · on reflection"),
        "Reviewed the captured step-count transcript for the browser-guidance migration.",
        "1 file changed · commit 616af1a",
        "reference/tooling/staged-deletion-gates.md · from conversation-a",
      ])
    })

    test.each(["no_changes", "failed", "timed_out", "merge_conflict", "parent_dirty", "dirty_uncommitted"] as const)(
      "#when the outcome is %s #then nothing draws in the transcript",
      (outcome) => {
        // when
        const component = renderReflectionCompletionEntry(
          { data: completion({ outcome, reason: "child_exit", detail: "merge refused", durationMs: 4300 }) } as never,
          { expanded: true },
          PLAIN_THEME as never,
        )

        // then
        expect(component).toBeUndefined()
      },
    )

    test("#when colour is applied #then the emphasis wraps the text rather than replacing it", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { theme: TAGGING_THEME })

      // then
      expect(lines).toEqual([
        `[accent]${bold("● Remembered · on reflection")}[/accent]`,
        "[dim]Kept what this session taught.[/dim]",
      ])
    })
  })

  describe("#given a reflection failure streak", () => {
    const health: ReflectionHealthEntry = {
      schemaVersion: 1,
      identity: "project-a1b2c3d4",
      streak: 4,
      fingerprint: "child_exit:merge refused",
      lastReason: "child_exit",
      lastDetail: "merge refused",
      sinceISO: "2026-08-12T22:15:00.000Z",
      recommendation: "Commit or stash the memory worktree, then rerun /memory reflect.",
    }

    test("#when the alert renders #then it is error toned with a bold title and leads with the remediation", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionHealthEntry, health, { expanded: true, theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("✗ Memory reflection failing · 4 runs in a row"),
        "Commit or stash the memory worktree, then rerun /memory reflect.",
        "reason child_exit · merge refused · since 2026-08-12T22:15:00.000Z · identity project-a1b2c3d4",
      ])
      expect(recorder.colors).toEqual(["error", "dim", "dim"])
    })

    test("#when the alert renders collapsed #then the detail row is omitted", () => {
      // when
      const lines = render(renderReflectionHealthEntry, health)

      // then
      expect(lines).toEqual([
        bold("✗ Memory reflection failing · 4 runs in a row"),
        "Commit or stash the memory worktree, then rerun /memory reflect.",
      ])
    })

    test("#when the recommendation is a fragment #then the why line is a full sentence", () => {
      // when
      const lines = render(renderReflectionHealthEntry, { ...health, recommendation: "run /login <provider>" })

      // then
      expect(lines[1]).toBe("Run /login <provider>.")
    })
  })

  describe("#given a narrow terminal", () => {
    test("#when the why must fit 24 columns #then it wraps onto a second line", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { width: 24 })

      // then
      expect(lines.slice(-2)).toEqual(["Kept what this session", "taught."])
    })

    test("#when coloured output is wrapped #then no terminal reset leaks into the middle of the why span", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { width: 22, theme: TAGGING_THEME })

      // then
      expect(lines.join("\n")).toContain("[dim]Kept what this")
      expect(lines.join("\n")).not.toContain("\u001b[0m")
    })

    test("#when the title is bolded at a narrow width #then the bold escapes wrap the whole fitted title", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { width: 32 })

      // then
      expect(lines[0]).toContain("\u001b[1m")
      expect(lines[0]).toContain("\u001b[22m")
      expect(lines[0].indexOf("\u001b[1m")).toBeLessThan(lines[0].indexOf("\u001b[22m"))
    })

    test("#when rendered at hostile widths #then no line ever exceeds the terminal width", () => {
      // given
      const record = completion({
        runId: "r".repeat(90),
        category: "c".repeat(40),
        model: "m".repeat(120),
        mergedCommitSha: "a".repeat(40),
        filesChanged: 12_345,
        durationMs: 9_999_999,
      })

      // when / then
      for (const width of [1, 5, 20, 40, 60, 80, 100]) {
        for (const line of render(renderReflectionCompletionEntry, record, { width, expanded: true })) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width)
        }
      }
    })
  })
})
