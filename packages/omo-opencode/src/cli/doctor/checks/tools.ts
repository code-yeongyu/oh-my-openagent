import { checkAstGrepCli, checkCommentChecker } from "./dependencies"
import { getGhCliInfo } from "./tools-gh"
import { getInstalledLspServers } from "./tools-lsp"
import { getBuiltinMcpInfo, getUserMcpInfo } from "./tools-mcp"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue, ToolsSummary } from "../framework/types"

export async function gatherToolsSummary(): Promise<ToolsSummary> {
  const [astGrepCliInfo, commentCheckerInfo, ghInfo] = await Promise.all([
    checkAstGrepCli(),
    checkCommentChecker(),
    getGhCliInfo(),
  ])

  const lspServers = getInstalledLspServers()
  const builtinMcp = getBuiltinMcpInfo()
  const userMcp = getUserMcpInfo()

  return {
    lspServers,
    astGrepCli: astGrepCliInfo.installed,
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

export function buildToolIssues(summary: ToolsSummary): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  if (!summary.astGrepCli) {
    issues.push({
      title: "AST-Grep unavailable",
      description: "AST-Grep CLI is not available.",
      fix: "The ast-grep skill resolves sg automatically; run omo doctor or lazycodex-ai doctor to check provisioning.",
      severity: "warning",
      affects: ["ast-grep skill"],
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

  if (summary.lspServers.length === 0) {
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
      `AST-Grep CLI: ${summary.astGrepCli ? "yes" : "no"}`,
      `Comment checker: ${summary.commentChecker ? "yes" : "no"}`,
      `LSP: ${summary.lspServers.length > 0 ? `${summary.lspServers.length} server(s)` : "none"}`,
      `GH CLI: ${summary.ghCli.installed ? "installed" : "missing"}${summary.ghCli.authenticated ? " (authenticated)" : ""}`,
      `MCP: builtin=${summary.mcpBuiltin.length}, user=${summary.mcpUser.length}`,
    ],
    issues,
  }
}
