import color from "picocolors"
import type { CheckStatus, DoctorIssue } from "./types"
import { SYMBOLS, STATUS_COLORS } from "./constants"

export function formatStatusSymbol(status: CheckStatus): string {
  const colorFn = STATUS_COLORS[status]
  switch (status) {
    case "pass":
      return colorFn(SYMBOLS.check)
    case "fail":
      return colorFn(SYMBOLS.cross)
    case "warn":
      return colorFn(SYMBOLS.warn)
    case "skip":
      return colorFn(SYMBOLS.skip)
  }
}

export function formatStatusMark(available: boolean): string {
  return available ? color.green(SYMBOLS.check) : color.red(SYMBOLS.cross)
}

export function stripAnsi(str: string): string {
  const ESC = String.fromCharCode(27)
  const pattern = ESC + "\\[[0-9;]*m"
  return str.replace(new RegExp(pattern, "g"), "")
}

export function formatHeader(): string {
  return `\n${color.bgMagenta(color.white(" oMoMoMoMo Doctor "))}\n`
}

export function formatIssue(issue: DoctorIssue, index: number): string {
  const lines: string[] = []
  const severityColor = issue.severity === "error" ? color.red : color.yellow

  lines.push(`${index}. ${severityColor(issue.title)}`)
  lines.push(`   ${color.dim(issue.description)}`)

  if (issue.fix) {
    lines.push(`   ${color.cyan("Fix:")} ${color.dim(issue.fix)}`)
  }

  if (issue.affects && issue.affects.length > 0) {
    lines.push(`   ${color.cyan("Affects:")} ${color.dim(issue.affects.join(", "))}`)
  }

  return lines.join("\n")
}
