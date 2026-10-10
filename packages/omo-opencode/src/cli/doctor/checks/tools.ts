import { findToolComponent, gatherToolComponents, isToolUsable, type ComponentsOptions } from "./components"
import { getInstalledLspServers } from "./tools-lsp"
import { getBuiltinMcpInfo, getUserMcpInfo } from "./tools-mcp"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue, ToolsSummary } from "../framework/types"

/**
 * The tool flags come from the shared component probes, so `astGrepCli` and `commentChecker`
 * mean "works", not "a file exists". Their problems are reported by the Components check.
 */
export async function gatherToolsSummary(options: ComponentsOptions = {}): Promise<ToolsSummary> {
  const tools = await gatherToolComponents(options)
  const gh = findToolComponent(tools, "gh")

  return {
    lspServers: getInstalledLspServers(options.cwd === undefined ? {} : { cwd: options.cwd }),
    astGrepCli: isToolUsable(findToolComponent(tools, "ast-grep")),
    commentChecker: isToolUsable(findToolComponent(tools, "comment-checker")),
    ghCli: {
      installed: gh !== undefined && gh.status !== "missing",
      authenticated: gh?.status === "ok",
      username: gh?.account ?? null,
    },
    mcpBuiltin: getBuiltinMcpInfo().map((server) => server.id),
    mcpUser: getUserMcpInfo().map((server) => server.id),
  }
}

export function buildToolIssues(invalidUserMcpServers: number): DoctorIssue[] {
  if (invalidUserMcpServers === 0) return []
  return [
    {
      title: "Invalid MCP server configuration",
      description: `${invalidUserMcpServers} user MCP server(s) have invalid config format.`,
      severity: "warning",
      affects: ["custom MCP tools"],
    },
  ]
}

export function createToolsCheck(options: ComponentsOptions = {}): () => Promise<CheckResult> {
  return async () => {
    const summary = await gatherToolsSummary(options)
    const issues = buildToolIssues(getUserMcpInfo().filter((server) => !server.valid).length)

    return {
      name: CHECK_NAMES[CHECK_IDS.TOOLS] ?? "Tools",
      status: issues.length === 0 ? "pass" : "warn",
      message: issues.length === 0 ? "All tools checks passed" : `${issues.length} tools issue(s) detected`,
      details: [
        `AST-Grep CLI: ${summary.astGrepCli ? "works" : "unavailable"}`,
        `Comment checker: ${summary.commentChecker ? "works" : "unavailable"}`,
        `LSP tools bridge: ${summary.lspServers.length > 0 ? "available" : "unavailable"} (server health: see Components)`,
        `GH CLI: ${summary.ghCli.installed ? "installed" : "missing"}${summary.ghCli.authenticated ? " (authenticated)" : ""}`,
        `MCP: builtin=${summary.mcpBuiltin.length}, user=${summary.mcpUser.length}`,
      ],
      issues,
    }
  }
}

export const checkTools = createToolsCheck()
