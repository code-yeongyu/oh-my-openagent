import type { MessageRenderer } from "@code-yeongyu/senpi"
import { buildNoticeBox } from "@oh-my-opencode/senpi-task/notice-box"

/**
 * User-visible upgrade notice emitted alongside the hidden fallback-architect directive.
 *
 * Unlike the directive and reminder (`display: false`, model-facing), this message ships with
 * `display: true` plus structured `details`, so the TUI renders the card below while future GUI
 * surfaces (omo-desktop-app) can key on the same custom type through senpi's session/event stream
 * without re-parsing prose. The tone is deliberate: a refusal fallback is not a downgrade — the
 * session keeps top-tier reasoning through the architect consult lane, so say so.
 */

export const FALLBACK_ARCHITECT_NOTICE_TYPE = "omo-fallback-architect:notice"

export interface FallbackArchitectNoticeDetails {
  readonly from: string
  readonly to: string
}

// Display flavor only: unknown selectors fall through to their bare model id, so the copy never
// blocks on this list being complete.
const FRIENDLY_MODEL_NAMES: readonly (readonly [RegExp, string])[] = [
  [/kimi-k3/i, "Kimi K3 (max)"],
  [/claude-fable-5/i, "Fable 5"],
  [/claude-opus-5/i, "Opus 5"],
  [/glm-5/i, "GLM 5.2"],
]

export function friendlyModelName(selector: string): string {
  for (const [pattern, name] of FRIENDLY_MODEL_NAMES) {
    if (pattern.test(selector)) return name
  }
  const id = selector.slice(selector.lastIndexOf("/") + 1)
  return id.length === 0 ? selector : id
}

export function buildFallbackArchitectNotice(input: FallbackArchitectNoticeDetails): string {
  const from = friendlyModelName(input.from)
  const to = friendlyModelName(input.to)
  return [
    `Model fallback engaged: ${input.from} -> ${input.to}.`,
    `${from} declined that one, so ${to} now drives the session — and top-tier reasoning stays one consult away through task(category: "architect"), which still runs Fable 5 at xhigh.`,
    `${to} on execution + Fable 5 xhigh on deep reasoning: two frontier brains on one session.`,
  ].join("\n")
}

export const renderFallbackArchitectNotice: MessageRenderer<FallbackArchitectNoticeDetails> = (message, options, theme) => {
  const details = message.details
  if (details === undefined) {
    return buildNoticeBox(
      {
        title: "⚡ Fallback upgrade engaged",
        tone: "accent",
        why: "The session switched to its configured fallback model.",
      },
      options,
      theme,
    )
  }
  const from = friendlyModelName(details.from)
  const to = friendlyModelName(details.to)
  return buildNoticeBox(
    {
      title: "⚡ Fallback upgrade engaged",
      tone: "accent",
      why: `${from} declined that one — ${to} takes the wheel, zero downtime.`,
      extra: [{ text: `Top-tier reasoning stays on call: task(category: "architect") still consults Fable 5 at xhigh.` }],
      expandedLine: `${to} on execution + Fable 5 xhigh on hard thinking — two frontier brains, one session.`,
    },
    options,
    theme,
  )
}
