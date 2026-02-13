import color from "picocolors"
import type { DoctorResult } from "./types"
import { formatHeader, formatStatusSymbol, formatIssue } from "./format-shared"

export function formatVerbose(result: DoctorResult): string {
  const lines: string[] = []

  lines.push(formatHeader())

  const { systemInfo, tools, results, summary } = result

  lines.push(`${color.bold("System Information")}`)
  lines.push(`${color.dim("\u2500".repeat(40))}`)
  lines.push(`  ${formatStatusSymbol("pass")} opencode    ${systemInfo.opencodeVersion ?? "unknown"}`)
  lines.push(`  ${formatStatusSymbol("pass")} oh-my-opencode ${systemInfo.pluginVersion ?? "unknown"}`)
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
  lines.push(`  ${formatStatusSymbol("pass")} LSP         ${tools.lspInstalled}/${tools.lspTotal} installed`)
  lines.push(`  ${formatStatusSymbol(tools.astGrepCli ? "pass" : "fail")} ast-grep CLI ${tools.astGrepCli ? "installed" : "not found"}`)
  lines.push(`  ${formatStatusSymbol(tools.astGrepNapi ? "pass" : "fail")} ast-grep napi ${tools.astGrepNapi ? "installed" : "not found"}`)
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
  const passText = summary.passed > 0 ? color.green(`${summary.passed} passed`) : `${summary.passed} passed`
  const failText = summary.failed > 0 ? color.red(`${summary.failed} failed`) : `${summary.failed} failed`
  const warnText = summary.warnings > 0 ? color.yellow(`${summary.warnings} warnings`) : `${summary.warnings} warnings`
  lines.push(`  ${passText}, ${failText}, ${warnText}`)
  lines.push(`  ${color.dim(`Total: ${summary.total} checks in ${summary.duration}ms`)}`)

  return lines.join("\n")
}
