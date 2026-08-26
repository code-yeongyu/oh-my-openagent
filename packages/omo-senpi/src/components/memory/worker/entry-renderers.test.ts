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

import {
  renderReflectionCompletionEntry,
  renderReflectionLaunchedEntry,
  renderReflectionSummaryEntry,
  type ReflectionCompletionRecord,
  type ReflectionCompletionSummary,
  type ReflectionLaunchedEntry,
} from "./completion"
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

function launched(over: Partial<ReflectionLaunchedEntry> = {}): ReflectionLaunchedEntry {
  return {
    schemaVersion: 1,
    runId: "reflection-run-2",
    identity: "project-a1b2c3d4",
    trigger: "step-count",
    category: "quick",
    conversationIds: ["conversation-a"],
    backlogSteps: 25,
    startedAt: "2026-08-13T09:00:00.000Z",
    ...over,
  }
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
  test("#given every registered memory notice renderer #when rendered #then each emits a custom-message background block", () => {
    const cases = [
      renderReflectionLaunchedEntry({ data: launched() } as never, { expanded: false }, BACKGROUND_THEME as never),
      renderReflectionCompletionEntry({ data: completion() } as never, { expanded: false }, BACKGROUND_THEME as never),
      renderReflectionSummaryEntry({ data: {
        schemaVersion: 1, identity: "project-a1b2c3d4", count: 1, failedCount: 0,
        oldestISO: "2026-08-11T04:00:00.000Z", newestISO: "2026-08-13T08:00:00.000Z",
      } } as never, { expanded: false }, BACKGROUND_THEME as never),
      renderReflectionHealthEntry({ data: {
        schemaVersion: 1, identity: "project-a1b2c3d4", streak: 3, fingerprint: "child_exit:stable",
        lastReason: "child_exit", sinceISO: "2026-08-12T22:15:00.000Z", recommendation: "Retry reflection.",
      } } as never, { expanded: false }, BACKGROUND_THEME as never),
    ]
    for (const component of cases) expectNoticeBackground(component!.render(WIDE))
  })
  describe("#given a launched reflection", () => {
    test("#when it renders collapsed #then a bold title leads a senpi notice with a visible context line", () => {
      // when
      const lines = render(renderReflectionLaunchedEntry, launched())

      // then
      expect(lines).toEqual([
        bold("◐ Memory reflection started · reflection-run-2"),
        "The outcome lands in this transcript when the run settles - triggered by step-count after 25 new steps.",
        "1 conversation · category quick",
      ])
    })

    test("#when a single backlog step is pending #then the step noun is singular", () => {
      // when
      const lines = render(renderReflectionLaunchedEntry, launched({ backlogSteps: 1 }))

      // then
      expect(lines[1]).toBe("The outcome lands in this transcript when the run settles - triggered by step-count after 1 new step.")
    })

    test("#when triggered manually #then the why line reads as a manual trigger", () => {
      // when
      const lines = render(renderReflectionLaunchedEntry, launched({ trigger: "manual" }))

      // then
      expect(lines[1]).toBe("The outcome lands in this transcript when the run settles - triggered manually after 25 new steps.")
    })

    test("#when it renders expanded #then the detail row carries identity started and trigger", () => {
      // when
      const lines = render(
        renderReflectionLaunchedEntry,
        launched({ model: "anthropic/claude-sonnet-4", thinking: "high" }),
        { expanded: true },
      )

      // then
      expect(lines).toEqual([
        bold("◐ Memory reflection started · reflection-run-2"),
        "The outcome lands in this transcript when the run settles - triggered by step-count after 25 new steps.",
        "1 conversation · category quick · model anthropic/claude-sonnet-4 · thinking high",
        "trigger step-count · identity project-a1b2c3d4 · started 2026-08-13T09:00:00.000Z",
      ])
    })

    test("#when in flight #then the title is accent toned and the secondary rows are dim", () => {
      // given
      const recorder = recordingTheme()

      // when
      render(renderReflectionLaunchedEntry, launched(), { expanded: true, theme: recorder.theme })

      // then
      expect(recorder.colors).toEqual(["accent", "dim", "dim", "dim"])
    })
  })

  describe("#given a completed reflection", () => {
    test("#when the outcome merged #then it reads as success with a prose summary", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("● Memory reflection merged · reflection-run-2"),
        "Reflection merged its findings into memory.",
      ])
      expect(recorder.colors).toEqual(["success", "dim"])
    })

    test("#when merge metadata is present #then the payoff line is visible in success tone", () => {
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
        bold("● Memory reflection merged · reflection-run-2"),
        "Reflection merged its findings into memory.",
        "3 files changed · commit 9f2c1ab · took 1m12s",
      ])
      expect(recorder.colors).toEqual(["success", "dim", "success"])
    })

    test("#when merge metadata is present and expanded #then the detail row carries identity and trigger", () => {
      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ filesChanged: 3, mergedCommitSha: "9f2c1ab7d3e4f5a6", durationMs: 72_000 }),
        { expanded: true },
      )

      // then
      expect(lines[3]).toBe("category quick · identity project-a1b2c3d4 · trigger step-count")
    })

    test("#when the outcome failed #then it reads as error with the cursor warning and a visible reason", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ outcome: "failed", reason: "child_exit" }),
        { theme: recorder.theme },
      )

      // then
      expect(lines).toEqual([
        bold("✗ Memory reflection failed · reflection-run-2"),
        "Reflection did not finish; the transcript cursor was not advanced.",
        "reason child_exit",
      ])
      expect(recorder.colors).toEqual(["error", "dim", "error"])
    })

    test("#when a failure carries a reason and detail #then both appear on the visible payoff line", () => {
      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ outcome: "failed", reason: "child_exit", detail: "merge refused", durationMs: 4300 }),
      )

      // then
      expect(lines[2]).toBe("took 4.3s · reason child_exit · merge refused")
    })

    test("#when a failure carries a reason and detail and is expanded #then the detail row carries identity", () => {
      // when
      const lines = render(
        renderReflectionCompletionEntry,
        completion({ outcome: "failed", reason: "child_exit", detail: "merge refused", durationMs: 4300 }),
        { expanded: true },
      )

      // then
      expect(lines[3]).toBe("category quick · identity project-a1b2c3d4 · trigger step-count")
    })

    test("#when the outcome timed out #then it reads as warning", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionCompletionEntry, completion({ outcome: "timed_out" }), {
        theme: recorder.theme,
      })

      // then
      expect(lines[0]).toBe(bold("⚠ Memory reflection timed out · reflection-run-2"))
      expect(recorder.colors[0]).toBe("warning")
    })

    test("#when the outcome is a clean no-op #then snake_case becomes readable prose", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion({ outcome: "no_changes" }))

      // then
      expect(lines).toEqual([
        bold("● Memory reflection no changes · reflection-run-2"),
        "Reflection finished with nothing new worth keeping.",
      ])
    })

    test("#when colour is applied #then the emphasis wraps the text rather than replacing it", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion(), { theme: TAGGING_THEME })

      // then
      expect(lines).toEqual([
        `[success]${bold("● Memory reflection merged · reflection-run-2")}[/success]`,
        "[dim]Reflection merged its findings into memory.[/dim]",
      ])
    })
  })

  describe("#given a collapsed backlog summary", () => {
    const summary: ReflectionCompletionSummary = {
      schemaVersion: 1,
      count: 7,
      failedCount: 2,
      oldestISO: "2026-08-11T04:00:00.000Z",
      newestISO: "2026-08-13T08:00:00.000Z",
      dominantFingerprint: "child_exit:merge refused",
    }

    test("#when failures are present #then it warns and surfaces the dominant fingerprint visibly", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionSummaryEntry, summary, { theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("⚠ Memory reflection · 7 older completions collapsed"),
        "Delivered while this session was away; 2 need attention.",
        "most common child_exit:merge refused",
      ])
      expect(recorder.colors).toEqual(["warning", "dim", "warning"])
    })

    test("#when nothing failed #then it stays muted and says so", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(renderReflectionSummaryEntry, { ...summary, failedCount: 0 }, { theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("● Memory reflection · 7 older completions collapsed"),
        "Delivered while this session was away; none need attention.",
      ])
      expect(recorder.colors).toEqual(["dim", "dim"])
    })

    test("#when exactly one completion collapsed #then the noun is singular", () => {
      // when
      const lines = render(renderReflectionSummaryEntry, { ...summary, count: 1, failedCount: 0 })

      // then
      expect(lines[0]).toBe(bold("● Memory reflection · 1 older completion collapsed"))
    })

    test("#when it renders collapsed #then the time range stays off the notice", () => {
      // when
      const lines = render(renderReflectionSummaryEntry, summary)

      // then
      expect(lines).toEqual([
        bold("⚠ Memory reflection · 7 older completions collapsed"),
        "Delivered while this session was away; 2 need attention.",
        "most common child_exit:merge refused",
      ])
    })

    test("#when it renders expanded #then the detail row carries the time range", () => {
      // when
      const lines = render(renderReflectionSummaryEntry, summary, { expanded: true })

      // then
      expect(lines[3]).toBe("oldest 2026-08-11T04:00:00.000Z · newest 2026-08-13T08:00:00.000Z")
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
    test("#when a long summary must fit 60 columns #then it degrades with an ellipsis and no stray reset", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion({ outcome: "failed" }), { width: 60 })

      // then
      expect(lines).toEqual([
        bold("✗ Memory reflection failed · reflection-run-2"),
        "Reflection did not finish; the transcript cursor was not",
        "advanced.",
      ])
    })

    test("#when a very long run id is rendered #then the identifier itself is excerpted", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion({ runId: "reflection-run-with-an-extremely-long-identifier" }))

      // then
      expect(lines[0]).toBe(bold("● Memory reflection merged · reflection-run-with-an-ex..."))
    })

    test("#when coloured output is truncated #then no terminal reset leaks into the middle of the why span", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion({ outcome: "failed" }), {
        width: 60,
        theme: TAGGING_THEME,
      })

      // then
      expect(lines.join("\n")).toContain("[dim]Reflection did not finish; the transcript cursor was")
      expect(lines.join("\n")).not.toContain("\u001b[0m")
    })

    test("#when the title is bolded at a narrow width #then the bold escapes wrap the whole fitted title", () => {
      // when
      const lines = render(renderReflectionCompletionEntry, completion({ outcome: "failed" }), { width: 60 })

      // then
      expect(lines[0]).toContain("\u001b[1m")
      expect(lines[0]).toContain("\u001b[22m")
      expect(lines[0].indexOf("\u001b[1m")).toBeLessThan(lines[0].indexOf("\u001b[22m"))
    })

    test("#when rendered at hostile widths #then no line ever exceeds the terminal width", () => {
      // given
      const record = completion({
        outcome: "failed",
        runId: "r".repeat(90),
        category: "c".repeat(40),
        reason: "z".repeat(40),
        detail: "d".repeat(300),
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
