import { checkAstGrepCli, checkAstGrepNapi, checkCommentChecker } from "./dependencies"
import { getGhCliInfo } from "./tools-gh"
import { getLspServerStats, getLspServersInfo } from "./tools-lsp"
import { getBuiltinMcpInfo, getUserMcpInfo } from "./tools-mcp"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue, ToolsSummary } from "../types"

export async function gatherToolsSummary(): Promise<ToolsSummary> {
  const [astGrepCliInfo, astGrepNapiInfo, commentCheckerInfo, ghInfo] = await Promise.all([
    checkAstGrepCli(),
    checkAstGrepNapi(),
    checkCommentChecker(),
    getGhCliInfo(),
  ])

  const lspServers = getLspServersInfo()
  const lspStats = getLspServerStats(lspServers)
  const builtinMcp = getBuiltinMcpInfo()
  const userMcp = getUserMcpInfo()

  return {
    lspInstalled: lspStats.installed,
    lspTotal: lspStats.total,
    astGrepCli: astGrepCliInfo.installed,
    astGrepNapi: astGrepNapiInfo.installed,
    commentChecker: commentCheckerInfo.installed,
    ghCli: {
      installed: ghInfo.installed,
      authenticated: ghInfo.authenticated,
      username: ghInfo.username,
    },
    mcpBuiltin: builtinMcp.map((server) => server.id),
    mcpUser: userMcp.map((server) => server.id),
  }
}

function buildToolIssues(summary: ToolsSummary): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  if (!summary.astGrepCli && !summary.astGrepNapi) {
    issues.push({
      title: "AST-Grep unavailable",
      description: "Neither AST-Grep CLI nor NAPI backend is available.",
      fix: "Install @ast-grep/cli globally or add @ast-grep/napi",
      severity: "warning",
      affects: ["ast_grep_search", "ast_grep_replace"],
    })
  }

  if (!summary.commentChecker) {
    issues.push({
      title: "Comment checker unavailable",
      description: "Comment checker binary is not installed.",
      fix: "Install @code-yeongyu/comment-checker",
      severity: "warning",
      affects: ["comment-checker hook"],
    })
  }

  if (summary.lspInstalled === 0) {
    issues.push({
      title: "No LSP servers detected",
      description: "LSP-dependent tools will be limited until at least one server is installed.",
      severity: "warning",
      affects: ["lsp diagnostics", "rename", "references"],
    })
  }

  if (!summary.ghCli.installed) {
    issues.push({
      title: "GitHub CLI missing",
      description: "gh CLI is not installed.",
      fix: "Install from https://cli.github.com/",
      severity: "warning",
      affects: ["GitHub automation"],
    })
  } else if (!summary.ghCli.authenticated) {
    issues.push({
      title: "GitHub CLI not authenticated",
      description: "gh CLI is installed but not logged in.",
      fix: "Run: gh auth login",
      severity: "warning",
      affects: ["GitHub automation"],
    })
  }

  return issues
}

export async function checkTools(): Promise<CheckResult> {
  const summary = await gatherToolsSummary()
  const userMcpServers = getUserMcpInfo()
  const invalidUserMcpServers = userMcpServers.filter((server) => !server.valid)
  const issues = buildToolIssues(summary)

  if (invalidUserMcpServers.length > 0) {
    issues.push({
      title: "Invalid MCP server configuration",
      description: `${invalidUserMcpServers.length} user MCP server(s) have invalid config format.`,
      severity: "warning",
      affects: ["custom MCP tools"],
    })
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.TOOLS],
    status: issues.length === 0 ? "pass" : "warn",
    message: issues.length === 0 ? "All tools checks passed" : `${issues.length} tools issue(s) detected`,
    details: [
      `AST-Grep: cli=${summary.astGrepCli ? "yes" : "no"}, napi=${summary.astGrepNapi ? "yes" : "no"}`,
      `Comment checker: ${summary.commentChecker ? "yes" : "no"}`,
      `LSP: ${summary.lspInstalled}/${summary.lspTotal}`,
      `GH CLI: ${summary.ghCli.installed ? "installed" : "missing"}${summary.ghCli.authenticated ? " (authenticated)" : ""}`,
      `MCP: builtin=${summary.mcpBuiltin.length}, user=${summary.mcpUser.length}`,
    ],
    issues,
  }
}
