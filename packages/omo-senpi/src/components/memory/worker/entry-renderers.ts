// Presentation layer for the memory reflection transcript entries.
//
// House style is Senpi's own notice family (`buildNoticeBox` behind
// `noticeEntryRenderer`, used by cache-keepalive and rule-activation): a glyph +
// bold tone-coloured title, a dim prose "why" line explaining what happened, and
// a dim detail line that only appears when the transcript row is expanded.
// Fields inside a line are separated by " · ", never emitted as `key:value` soup.
//
// `noticeEntryRenderer`/`NoticeSpec` are internal to senpi (absent from the 145
// public exports and from package.json "exports"), so importing them would bind
// us to private paths. We reproduce the same visual contract on top of the
// in-repo `linesComponent`, which is what every sibling omo renderer already uses.

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
  rendererVisibleWidth,
} from "@oh-my-opencode/senpi-task/renderer-text"
import { linesComponent } from "@oh-my-opencode/senpi-task/task-renderers"
import { truncateToWidth } from "@earendil-works/pi-tui"

/** The subset of Theme an entry renderer needs; keeps fakes cheap in tests. */
export type EntryRenderTheme = Pick<Theme, "fg" | "italic">

type RenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

/** Separator used by every Senpi notice title/detail line. */
export const FIELD_SEPARATOR = " · "

const RUN_EXCERPT_WIDTH = 28
const DETAIL_EXCERPT_WIDTH = 72

/**
 * Outcome -> ThemeColor, following the `statusThemeColor` convention from
 * senpi-task: success/error/warning/accent/muted only, no invented names.
 */
const OUTCOME_COLORS: Readonly<Record<string, ThemeColor>> = {
  merged: "success",
  no_changes: "success",
  parent_dirty: "warning",
  merge_conflict: "warning",
  dirty_uncommitted: "warning",
  timed_out: "warning",
  failed: "error",
}

export function outcomeThemeColor(outcome: string): ThemeColor {
  return Object.hasOwn(OUTCOME_COLORS, outcome) ? OUTCOME_COLORS[outcome] : "muted"
}

/** Glyph vocabulary mirrors senpi's own notice titles (● steady, ⚠ attention, ✗ failure). */
export function outcomeGlyph(outcome: string): string {
  const color = outcomeThemeColor(outcome)
  if (color === "success") return "●"
  if (color === "error") return "✗"
  if (color === "warning") return "⚠"
  return "·"
}

/** Human phrasing for an outcome, replacing the raw snake_case token. */
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "merged":
      return "merged"
    case "no_changes":
      return "no changes"
    case "parent_dirty":
      return "parent dirty"
    case "merge_conflict":
      return "merge conflict"
    case "dirty_uncommitted":
      return "dirty worktree"
    case "timed_out":
      return "timed out"
    case "failed":
      return "failed"
    default:
      return normalizeRendererText(outcome)
  }
}

/** The prose "why" line: what actually happened, in a full sentence. */
export function outcomeSummary(outcome: string): string {
  switch (outcome) {
    case "merged":
      return "Reflection merged its findings into memory."
    case "no_changes":
      return "Reflection finished with nothing new worth keeping."
    case "parent_dirty":
      return "Memory had uncommitted changes, so the merge was skipped."
    case "merge_conflict":
      return "The reflection branch conflicted with memory and was left unmerged."
    case "dirty_uncommitted":
      return "The reflection worktree ended dirty, so nothing was merged."
    case "timed_out":
      return "Reflection hit its deadline; the transcript cursor was not advanced."
    case "failed":
      return "Reflection did not finish; the transcript cursor was not advanced."
    default:
      return "Reflection finished with an unrecognised outcome."
  }
}

/** Raw SGR bold on/off, mirroring senpi notice/box.ts title emphasis. */
const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"

/** A visible notice line carrying its own tone, mirroring senpi's NoticeLine. */
export type NoticeExtraLine = { readonly text: string; readonly tone?: ThemeColor }

/**
 * Build a notice-shaped component matching senpi notice/box.ts: a bold tone-coloured
 * title, a dim "why" line, zero or more visible "extra" lines each with their own
 * semantic tone, and a dim italic detail line gated behind the expanded flag.
 * Truncation happens on the plain text before colouring and before the bold wrap,
 * so ANSI sequences are never sliced.
 */
export function noticeComponent(
  spec: {
    readonly glyph: string
    readonly title: string
    readonly tone: ThemeColor
    readonly why: string
    readonly extra?: readonly NoticeExtraLine[]
    readonly detail?: string
  },
  options: { readonly expanded: boolean },
  theme: EntryRenderTheme,
): RenderComponent {
  return linesComponent((width: number): readonly string[] => {
    if (width <= 0) return [""]
    const title = fit(`${spec.glyph} ${spec.title}`, width)
    const lines = [theme.fg(spec.tone, `${BOLD}${title}${BOLD_OFF}`), theme.fg("dim", fit(spec.why, width))]
    for (const line of spec.extra ?? []) {
      if (line.text.length === 0) continue
      lines.push(theme.fg(line.tone ?? "dim", fit(line.text, width)))
    }
    if (options.expanded && spec.detail !== undefined && spec.detail.length > 0) {
      lines.push(theme.italic(theme.fg("dim", fit(spec.detail, width))))
    }
    return lines
  })
}

/**
 * Truncate plain text to the visible width, matching sibling renderers' ELLIPSIS.
 *
 * `truncateToWidth` wraps its ellipsis in its own SGR reset (\e[0m...\e[0m). Left in
 * place that reset would terminate the colour `theme.fg` wraps around us, so the
 * result is re-normalised to strip every control sequence before it is coloured.
 */
export function fit(text: string, width: number): string {
  if (width <= 0) return ""
  const normalized = normalizeRendererText(text)
  if (rendererVisibleWidth(normalized) <= width) return normalized
  return normalizeRendererText(truncateToWidth(normalized, width, ELLIPSIS))
}

/** Join non-empty fields with the notice separator. */
export function joinFields(fields: readonly (string | undefined)[]): string {
  return fields.filter((field): field is string => typeof field === "string" && field.length > 0).join(FIELD_SEPARATOR)
}

/** Short run label; long ids degrade with an ellipsis instead of wrapping. */
export function runLabel(runId: string): string {
  return excerptRendererText(runId, RUN_EXCERPT_WIDTH)
}

/** Bounded excerpt for free-form detail/reason text. */
export function detailExcerpt(detail: string): string {
  return excerptRendererText(detail, DETAIL_EXCERPT_WIDTH)
}

export { joinRendererTokens, normalizeRendererText, optionalRendererText }
