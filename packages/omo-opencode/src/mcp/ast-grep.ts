import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCliSuffix } from "./cli-suffix";
import type { LocalMcpConfig } from "./lsp";
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable";
import { createAncestorCliCandidates, resolveJavaScriptRuntime, type AncestorCliCandidate } from "./shared/ancestor-cli-resolver";

const PACKAGE_REL = "packages/ast-grep-mcp";
const DIST_CLI_REL = "dist/cli.js";
const SOURCE_CLI_REL = "src/cli.ts";
const WORKSPACE_ENV = "OMO_AST_GREP_WORKSPACE";
const DISABLED_TOOLS_ENV = "OMO_AST_GREP_DISABLED_TOOLS";

const MCP_TOOL_BY_OPENCODE_TOOL: Readonly<Record<string, string>> = {
  ast_grep_search: "search",
  ast_grep_replace: "replace",
};

type AstGrepMcpConfigOptions = {
  readonly cwd?: string;
  readonly disabledTools?: readonly string[];
  readonly moduleUrl?: string;
  readonly exists?: (path: string) => boolean;
  readonly resolveExecutable?: RuntimeExecutableResolver;
};

function getModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}

function createFallbackCandidate(resolveExecutable: RuntimeExecutableResolver): AncestorCliCandidate {
  const runtime = resolveJavaScriptRuntime(resolveExecutable);
  const path = resolve(PACKAGE_REL, DIST_CLI_REL);
  return {
    command: [runtime.command, path, "mcp"],
    root: process.cwd(),
    path,
    exists: runtime.available,
    runtimeAvailable: runtime.available,
  };
}

function resolveAstGrepCommand(options: AstGrepMcpConfigOptions = {}): AncestorCliCandidate {
  const pathExists = options.exists ?? existsSync;
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable;
  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url);
  const candidates = moduleDirectory
    ? createAncestorCliCandidates({
        startDirectory: moduleDirectory,
        packageRel: PACKAGE_REL,
        distCliRel: DIST_CLI_REL,
        sourceCliRel: SOURCE_CLI_REL,
        pathExists,
        resolveExecutable,
      })
    : [];

  const distCandidate = candidates.find((candidate) => hasCliSuffix(candidate.path, DIST_CLI_REL) && candidate.exists);
  if (distCandidate) return distCandidate;
  const sourceCandidate = candidates.find((candidate) => hasCliSuffix(candidate.path, SOURCE_CLI_REL) && candidate.exists);
  if (sourceCandidate) return sourceCandidate;
  const fallbackCandidate =
    candidates.find((candidate) => hasCliSuffix(candidate.path, DIST_CLI_REL)) ?? createFallbackCandidate(resolveExecutable);
  return { ...fallbackCandidate, exists: fallbackCandidate.runtimeAvailable };
}

function astGrepDisabledTools(disabledTools: readonly string[] | undefined): string {
  if (!disabledTools) return "";
  return disabledTools
    .map((toolName) => MCP_TOOL_BY_OPENCODE_TOOL[toolName])
    .filter((toolName): toolName is string => typeof toolName === "string")
    .join(",");
}

export function createAstGrepMcpConfig(options: AstGrepMcpConfigOptions = {}): LocalMcpConfig {
  const workspaceDirectory = options.cwd ?? process.cwd();
  const resolvedCommand = resolveAstGrepCommand(options);
  return {
    type: "local",
    command: resolvedCommand.command,
    enabled: resolvedCommand.exists,
    environment: {
      [WORKSPACE_ENV]: workspaceDirectory,
      [DISABLED_TOOLS_ENV]: astGrepDisabledTools(options.disabledTools),
    },
  };
}
