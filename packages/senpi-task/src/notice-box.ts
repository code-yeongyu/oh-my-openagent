import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import type { Component } from "@earendil-works/pi-tui"

import { piTui } from "./lazy/pi-tui"

export type NoticeTone = "accent" | "warning" | "error" | "success" | "dim"

export type NoticeLine = {
  readonly text: string
  readonly tone?: NoticeTone
}

export type NoticeSpec = {
  readonly title: string
  readonly tone?: NoticeTone
  readonly why: string
  readonly extra?: readonly NoticeLine[]
  readonly expandedLine?: string
}

export type NoticeTheme = Pick<Theme, "fg" | "bg">

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"

// Canonical contract: senpi buildNoticeBox. Replace this local copy once the pinned
// @code-yeongyu/senpi package exports that helper.
export function buildNoticeBox(
  spec: NoticeSpec,
  options: { readonly expanded: boolean },
  theme: NoticeTheme,
): Component {
  const { Box, Text } = piTui()
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text))
  box.addChild(new Text(theme.fg(spec.tone ?? "accent", `${BOLD}${spec.title}${BOLD_OFF}`), 0, 0))
  box.addChild(new Text(theme.fg("dim", spec.why), 0, 0))
  for (const line of spec.extra ?? []) {
    box.addChild(new Text(theme.fg(line.tone ?? "dim", line.text), 0, 0))
  }
  if (options.expanded && spec.expandedLine !== undefined) {
    box.addChild(new Text(theme.fg("dim", spec.expandedLine), 0, 0))
  }
  return box
}

export function noticeTone(color: ThemeColor): NoticeTone {
  return color === "muted" ? "dim" : color === "accent" || color === "warning" || color === "error" || color === "success" || color === "dim"
    ? color
    : "dim"
}
