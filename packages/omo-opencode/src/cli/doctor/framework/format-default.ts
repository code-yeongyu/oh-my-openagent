import color from "picocolors"
import type { DoctorResult } from "./types"
import { SYMBOLS, EDITION_LABELS, UPDATE_COMMANDS, LATEST_UNAVAILABLE_TEXT } from "./constants"
import { formatHeader, formatIssue } from "./format-shared"

function formatOkSummary(result: DoctorResult, headline: string, installedVersion: string): string[] {
  const target = result.target ?? "opencode"
  const latest = result.latestVersion ?? LATEST_UNAVAILABLE_TEXT
  return [
    ` ${color.green(SYMBOLS.check)} ${color.green(
      `${headline} · Edition: ${EDITION_LABELS[target]} · Installed: ${installedVersion} · Latest: ${latest}`
    )}`,
    `   Update: ${UPDATE_COMMANDS[target]}`,
  ]
}

export function formatDefault(result: DoctorResult): string {
  const lines: string[] = []

  lines.push(formatHeader())

  const allIssues = result.results.flatMap((r) => r.issues)

  if (allIssues.length === 0) {
    if (result.target === "codex" && result.codex) {
      const packageVer = result.codex.packageVersion ?? result.codex.installerVersion
      lines.push(...formatOkSummary(result, "LazyCodex OK", packageVer))
      return lines.join("\n")
    }
    const pluginVer = result.systemInfo.pluginVersion ?? "unknown"
    lines.push(...formatOkSummary(result, "System OK", pluginVer))
  } else {
    const issueCount = allIssues.filter((i) => i.severity === "error").length
    const warnCount = allIssues.filter((i) => i.severity === "warning").length

    const totalStr = `${issueCount + warnCount} ${issueCount + warnCount === 1 ? "issue" : "issues"}`
    lines.push(` ${color.yellow(SYMBOLS.warn)} ${totalStr} found:\n`)

    allIssues.forEach((issue, index) => {
      lines.push(formatIssue(issue, index + 1))
      lines.push("")
    })
  }

  return lines.join("\n")
}
