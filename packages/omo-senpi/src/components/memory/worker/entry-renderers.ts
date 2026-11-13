// Presentation layer for the memory reflection transcript entries.
//
// Fields inside a line are separated by " · ", never emitted as `key:value` soup.

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { buildNoticeBox, noticeTone, type NoticeLine } from "@oh-my-opencode/senpi-task/notice-box"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
  rendererVisibleWidth,
} from "@oh-my-opencode/senpi-task/renderer-text"
import { truncateToWidth } from "@earendil-works/pi-tui"

/** The subset of Theme an entry renderer needs; keeps fakes cheap in tests. */
export type EntryRenderTheme = Pick<Theme, "fg" | "bg">

type RenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

/** Separator used by every Senpi notice title/detail line. */
export const FIELD_SEPARATOR = " · "

const RUN_EXCERPT_WIDTH = 28
const DETAIL_EXCERPT_WIDTH = 72

/** A visible notice line carrying its own tone, mirroring senpi's NoticeLine. */
export type NoticeExtraLine = { readonly text: string; readonly tone?: ThemeColor }

/** Keep the existing public shape while delegating all layout to the shared notice box. */
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
  const extra: NoticeLine[] = []
  for (const line of spec.extra ?? []) {
    if (line.text.length === 0) continue
    extra.push({ text: line.text, tone: noticeTone(line.tone ?? "dim") })
  }
  return buildNoticeBox(
    {
      title: `${spec.glyph} ${spec.title}`,
      tone: noticeTone(spec.tone),
      why: spec.why,
      extra,
      ...(spec.detail === undefined || spec.detail.length === 0 ? {} : { expandedLine: spec.detail }),
    },
    options,
    theme,
  )
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
