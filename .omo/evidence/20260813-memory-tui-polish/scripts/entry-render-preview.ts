// Evidence generator: renders each memory transcript entry through the REAL
// renderer with an ANSI theme at multiple widths. Run:
//   bun run packages/omo-senpi/src/components/memory/worker/entry-render-preview.ts
import type { ThemeColor } from "@code-yeongyu/senpi"

import {
  renderReflectionCompletionEntry,
  renderReflectionLaunchedEntry,
  renderReflectionSummaryEntry,
  type ReflectionCompletionRecord,
  type ReflectionCompletionSummary,
  type ReflectionLaunchedEntry,
} from "./completion"
import { renderReflectionHealthEntry, type ReflectionHealthEntry } from "./health-alert"

const ANSI: Record<ThemeColor | "dim", string> = {
  success: "\u001b[32m",
  error: "\u001b[31m",
  warning: "\u001b[33m",
  accent: "\u001b[36m",
  muted: "\u001b[90m",
  dim: "\u001b[2m",
} as unknown as Record<ThemeColor | "dim", string>

const theme = {
  fg: (color: ThemeColor, text: string) => `${ANSI[color] ?? "\u001b[37m"}${text}\u001b[0m`,
  italic: (text: string) => `\u001b[3m${text}\u001b[0m`,
}

const launched: ReflectionLaunchedEntry = {
  schemaVersion: 1,
  runId: "reflection-run-2",
  identity: "project-a1b2c3d4",
  trigger: "step-count",
  category: "quick",
  model: "anthropic/claude-sonnet-4",
  thinking: "high",
  conversationIds: ["conversation-a"],
  backlogSteps: 25,
  startedAt: "2026-08-13T09:00:00.000Z",
}

function completion(over: Partial<ReflectionCompletionRecord>): ReflectionCompletionRecord {
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
    durationMs: 72_000,
    filesChanged: 3,
    mergedCommitSha: "9f2c1ab7d3e4f5a6",
    delivery: { status: "consumed" },
    ...over,
  }
}

const summary: ReflectionCompletionSummary = {
  schemaVersion: 1,
  count: 7,
  failedCount: 2,
  oldestISO: "2026-08-11T04:00:00.000Z",
  newestISO: "2026-08-13T08:00:00.000Z",
  dominantFingerprint: "child_exit:worktree merge refused because memory was dirty",
}

const health: ReflectionHealthEntry = {
  schemaVersion: 1,
  identity: "project-a1b2c3d4",
  streak: 4,
  fingerprint: "child_exit:worktree merge refused",
  lastReason: "child_exit",
  lastDetail: "worktree merge refused because memory had uncommitted changes",
  sinceISO: "2026-08-12T22:15:00.000Z",
  recommendation: "Commit or stash the memory worktree, then rerun /memory reflect.",
}

type AnyRenderer = (entry: { data: unknown }, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] } | undefined

const cases: Array<{ label: string; renderer: AnyRenderer; data: unknown }> = [
  { label: "reflection-launched", renderer: renderReflectionLaunchedEntry as AnyRenderer, data: launched },
  { label: "reflection-completion (merged)", renderer: renderReflectionCompletionEntry as AnyRenderer, data: completion({}) },
  {
    label: "reflection-completion (failed)",
    renderer: renderReflectionCompletionEntry as AnyRenderer,
    data: completion({
      outcome: "failed",
      reason: "child_exit",
      detail: "worktree merge refused because memory had uncommitted changes on the target branch",
      durationMs: 4300,
      filesChanged: undefined,
      mergedCommitSha: undefined,
    }),
  },
  {
    label: "reflection-completion (timed out)",
    renderer: renderReflectionCompletionEntry as AnyRenderer,
    data: completion({ outcome: "timed_out", reason: "deadline_exceeded", durationMs: 600_000, filesChanged: undefined, mergedCommitSha: undefined }),
  },
  { label: "reflection-summary", renderer: renderReflectionSummaryEntry as AnyRenderer, data: summary },
  { label: "senpi-memory.health", renderer: renderReflectionHealthEntry as AnyRenderer, data: health },
]

const widths = [60, 100]
const out: string[] = []

for (const width of widths) {
  out.push(`+${"-".repeat(width)}+`)
  out.push(`|${` TERMINAL WIDTH ${width} `.padEnd(width, " ")}|`)
  out.push(`+${"-".repeat(width)}+`)
  for (const { label, renderer, data } of cases) {
    for (const expanded of [false, true]) {
      const component = renderer({ data }, { expanded }, theme)
      if (component === undefined) continue
      out.push("")
      out.push(`  ${label} [${expanded ? "expanded" : "collapsed"}]`)
      for (const line of component.render(width)) out.push(`  ${line}`)
    }
  }
  out.push("")
}

process.stdout.write(`${out.join("\r\n")}\r\n`)
