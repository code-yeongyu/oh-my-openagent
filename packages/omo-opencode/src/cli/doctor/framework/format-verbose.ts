import color from "picocolors"
import { PLUGIN_NAME } from "../../../shared"
import type { DoctorIssue, DoctorResult } from "./types"
import { formatHeader, formatStatusSymbol, formatIssue } from "./format-shared"

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function passedChecks(count: number): string {
  return count === 1 ? "1 check passed" : `${count} checks passed`
}

function formatIssueCountSummary(issues: readonly DoctorIssue[]): string | undefined {
  if (issues.length === 0) return undefined
  const warnings = issues.filter((issue) => issue.severity === "warning").length
  const errors = issues.filter((issue) => issue.severity === "error").length
  const parts = [
    warnings > 0 ? plural(warnings, "warning") : undefined,
    errors > 0 ? plural(errors, "error") : undefined,
  ].filter((part): part is string => part !== undefined)
  return `${plural(issues.length, "issue")} found (${parts.join(", ")})`
}

function formatCheckSummary(result: DoctorResult, issues: readonly DoctorIssue[]): string[] {
  const { summary } = result
  const skippedText = summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""
  const lines = [
    `  ${passedChecks(summary.passed)}, ${summary.failed} failed, ${summary.warnings} with warnings${skippedText}`,
  ]
  const issueSummary = formatIssueCountSummary(issues)
  if (issueSummary !== undefined) lines.push(`  ${issueSummary}`)
  lines.push(`  ${color.dim(`Total: ${summary.total} checks in ${summary.duration}ms`)}`)
  return lines
}

export function formatVerbose(result: DoctorResult): string {
  const lines: string[] = []

  lines.push(formatHeader())

  const { systemInfo, tools, results, summary } = result

  if (result.target === "codex" && result.codex) {
    lines.push(`${color.bold("Codex Information")}`)
    lines.push(`${color.dim("\u2500".repeat(40))}`)
    lines.push(`  ${formatStatusSymbol(result.codex.codexPath || result.codex.codexAppId ? "pass" : "fail")} codex      ${result.codex.codexPath ?? result.codex.codexAppId ?? "not detected"}`)
    lines.push(`  ${formatStatusSymbol("pass")} cli        oh-my-openagent@${result.codex.installerVersion}`)
    lines.push(`  ${formatStatusSymbol(result.codex.config.marketplaceConfigured ? "pass" : "fail")} marketplace ${result.codex.marketplaceName}`)
    lines.push(`  ${formatStatusSymbol(result.codex.pluginRoot ? (result.codex.pluginVersionStamped ? "pass" : "warn") : "fail")} plugin     ${result.codex.pluginName}@${result.codex.pluginVersion ?? "unknown"}${result.codex.pluginVersionStamped ? "" : " (placeholder)"}`)
    lines.push(`  ${formatStatusSymbol(result.codex.packageVersion ? "pass" : "warn")} package    ${result.codex.packageName ?? "unknown"}@${result.codex.packageVersion ?? "unknown"}`)
    lines.push(`  ${formatStatusSymbol(result.codex.config.pluginEnabled ? "pass" : "fail")} config     ${result.codex.configPath}`)
    lines.push(`  ${formatStatusSymbol(result.codex.linkedBins.length > 0 ? "pass" : "warn")} bins       ${result.codex.linkedBins.length > 0 ? result.codex.linkedBins.join(", ") : "none"}`)
    lines.push(`  ${formatStatusSymbol(result.codex.agents.length > 0 ? "pass" : "warn")} agents     ${result.codex.agents.length > 0 ? result.codex.agents.join(", ") : "none"}`)
    lines.push("")

    for (const check of results) {
      if (!check.details || check.details.length === 0) continue
      lines.push(`${color.bold(check.name)}`)
      lines.push(`${color.dim("\u2500".repeat(40))}`)
      for (const detail of check.details) {
        lines.push(detail)
      }
      lines.push("")
    }

    const allIssues = results.flatMap((r) => r.issues)
    if (allIssues.length > 0) {
      lines.push(`${color.bold("Issues")}`)
      lines.push(`${color.dim("\u2500".repeat(40))}`)
      allIssues.forEach((issue, index) => {
        lines.push(formatIssue(issue, index + 1))
        lines.push("")
      })
    }

    lines.push(`${color.bold("Summary")}`)
    lines.push(`${color.dim("\u2500".repeat(40))}`)
    lines.push(...formatCheckSummary(result, allIssues))
    return lines.join("\n")
  }

  lines.push(`${color.bold("System Information")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  lines.push(`  ${formatStatusSymbol("pass")} opencode    ${systemInfo.opencodeVersion ?? "unknown"}`)
  lines.push(`  ${formatStatusSymbol("pass")} ${PLUGIN_NAME} ${systemInfo.pluginVersion ?? "unknown"}`)
  if (systemInfo.loadedVersion) {
    lines.push(`  ${formatStatusSymbol("pass")} loaded      ${systemInfo.loadedVersion}`)
  }
  if (systemInfo.bunVersion) {
    lines.push(`  ${formatStatusSymbol("pass")} bun         ${systemInfo.bunVersion}`)
  }
  lines.push(`  ${formatStatusSymbol("pass")} path        ${systemInfo.opencodePath ?? "unknown"}`)
  if (systemInfo.isLocalDev) {
    lines.push(`  ${color.yellow("*")} ${color.dim("(local development mode)")}`)
  }
  lines.push("")

  lines.push(`${color.bold("Configuration")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  const configStatus = systemInfo.configValid ? color.green("valid") : color.red("invalid")
  lines.push(`  ${formatStatusSymbol(systemInfo.configValid ? "pass" : "fail")} ${systemInfo.configPath ?? "unknown"} (${configStatus})`)
  lines.push("")

  lines.push(`${color.bold("Tools")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  if (tools.lspServers.length === 0) {
    lines.push(`  ${formatStatusSymbol("warn")} LSP         none detected`)
  } else {
    const count = tools.lspServers.length
    lines.push(`  ${formatStatusSymbol("pass")} LSP         ${count} server${count === 1 ? "" : "s"}`)
    for (const server of tools.lspServers) {
      lines.push(`${" ".repeat(20)}${server.id} (${server.extensions.join(", ")})`)
    }
  }
  lines.push(`  ${formatStatusSymbol(tools.astGrepCli ? "pass" : "fail")} ast-grep CLI ${tools.astGrepCli ? "installed" : "not found"}`)
  lines.push(`  ${formatStatusSymbol(tools.commentChecker ? "pass" : "fail")} comment-checker ${tools.commentChecker ? "installed" : "not found"}`)
  lines.push(`  ${formatStatusSymbol(tools.ghCli.installed && tools.ghCli.authenticated ? "pass" : "fail")} gh CLI ${tools.ghCli.installed ? "installed" : "not found"}${tools.ghCli.authenticated && tools.ghCli.username ? ` (${tools.ghCli.username})` : ""}`)
  lines.push("")

  lines.push(`${color.bold("MCPs")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  if (tools.mcpBuiltin.length === 0) {
    lines.push(`  ${color.dim("No built-in MCPs")}`)
  } else {
    for (const mcp of tools.mcpBuiltin) {
      lines.push(`  ${formatStatusSymbol("pass")} ${mcp}`)
    }
  }
  if (tools.mcpUser.length > 0) {
    lines.push(`  ${color.cyan("+")} ${tools.mcpUser.length} user MCP(s):`)
    for (const mcp of tools.mcpUser) {
      lines.push(`    ${formatStatusSymbol("pass")} ${mcp}`)
    }
  }
  lines.push("")

  for (const check of results) {
    if (!check.details || check.details.length === 0) {
      continue
    }

    lines.push(`${color.bold(check.name)}`)
    lines.push(`${color.dim("\u2500".repeat(40))}`)
    for (const detail of check.details) {
      lines.push(detail)
    }
    lines.push("")
  }

  const allIssues = results.flatMap((r) => r.issues)
  if (allIssues.length > 0) {
    lines.push(`${color.bold("Issues")}`)
    lines.push(`${color.dim("\u2500".repeat(40))}`)
    allIssues.forEach((issue, index) => {
      lines.push(formatIssue(issue, index + 1))
      lines.push("")
    })
  }

  lines.push(`${color.bold("Summary")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  const passText = summary.passed > 0 ? color.green(passedChecks(summary.passed)) : passedChecks(summary.passed)
  const failText = summary.failed > 0 ? color.red(`${summary.failed} failed`) : `${summary.failed} failed`
  const warnText = summary.warnings > 0 ? color.yellow(`${summary.warnings} with warnings`) : `${summary.warnings} with warnings`
  const skipText = summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""
  lines.push(`  ${passText}, ${failText}, ${warnText}${skipText}`)
  const issueSummary = formatIssueCountSummary(allIssues)
  if (issueSummary !== undefined) lines.push(`  ${issueSummary}`)
  lines.push(`  ${color.dim(`Total: ${summary.total} checks in ${summary.duration}ms`)}`)

  return lines.join("\n")
}
