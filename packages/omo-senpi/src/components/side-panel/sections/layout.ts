import type { PanelRow } from "../types"

/** Width of the label gutter every section shares, so values line up down the column. */
export const LABEL_WIDTH = 8

/** A section heading: the name, and the one number that summarises it. */
export function heading(name: string, summary?: string): PanelRow {
  return { text: summary === undefined ? name : `${name}  ${summary}`, color: "accent" }
}

/** A `label  value` line. The label is padded so values form a column. */
export function field(label: string, value: string, color: PanelRow["color"] = "text"): PanelRow {
  return { text: `${label.padEnd(LABEL_WIDTH)}${value}`, color }
}

/** A blank separator, used between sections rather than inside them. */
export function spacer(): PanelRow {
  return { text: "" }
}

/** Width left for a bar after the label gutter and a trailing value of `tail` characters. */
export function barWidth(width: number, tail: number): number {
  return Math.max(0, width - LABEL_WIDTH - tail)
}
