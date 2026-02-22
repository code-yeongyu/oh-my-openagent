import color from "picocolors"
import type { DoctorResult } from "./types"
import { SYMBOLS } from "./constants"
import { formatHeader, formatIssue } from "./format-shared"

export function formatDefault(result: DoctorResult): string {
  const lines: string[] = []

  lines.push(formatHeader())

  const allIssues = result.results.flatMap((r) => r.issues)

  if (allIssues.length === 0) {
    const opencodeVer = result.systemInfo.opencodeVersion ?? "unknown"
    const pluginVer = result.systemInfo.pluginVersion ?? "unknown"
    lines.push(
      ` ${color.green(SYMBOLS.check)} ${color.green(
        `System OK (opencode ${opencodeVer} · oh-my-opencode ${pluginVer})`
      )}`
    )
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
