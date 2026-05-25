import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCliSuffix } from "./cli-suffix";
import type { LocalMcpConfig } from "./lsp";
import { resolveRuntimeExecutable, type RuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable";

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

type CommandCandidate = {
  readonly command: string[];
  readonly path: string;
  readonly exists: boolean;
  readonly runtimeAvailable: boolean;
};

function resolveJavaScriptRuntime(resolveExecutable: RuntimeExecutableResolver): RuntimeExecutable {
  const node = resolveExecutable("node");
  return node.available ? node : resolveExecutable("bun");
}

function addAncestorCommandCandidates(
  startDirectory: string,
  target: CommandCandidate[],
  seenPaths: Set<string>,
  pathExists: (path: string) => boolean,
  resolveExecutable: RuntimeExecutableResolver,
): void {
  let currentDirectory = resolve(startDirectory);
  while (true) {
    const distCliPath = resolve(currentDirectory, PACKAGE_REL, DIST_CLI_REL);
    if (!seenPaths.has(distCliPath)) {
      const runtime = resolveJavaScriptRuntime(resolveExecutable);
      seenPaths.add(distCliPath);
      target.push({
        command: [runtime.command, distCliPath, "mcp"],
        path: distCliPath,
        exists: runtime.available && pathExists(distCliPath),
        runtimeAvailable: runtime.available,
      });
    }

    const sourceCliPath = resolve(currentDirectory, PACKAGE_REL, SOURCE_CLI_REL);
    if (!seenPaths.has(sourceCliPath)) {
      const runtime = resolveExecutable("bun");
      seenPaths.add(sourceCliPath);
      target.push({
        command: [runtime.command, sourceCliPath, "mcp"],
        path: sourceCliPath,
        exists: runtime.available && pathExists(sourceCliPath),
        runtimeAvailable: runtime.available,
      });
    }

    const parentDirectory = resolve(currentDirectory, "..");
    if (parentDirectory === currentDirectory) return;
    currentDirectory = parentDirectory;
  }
}

function getModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
}

function createFallbackCandidate(resolveExecutable: RuntimeExecutableResolver): CommandCandidate {
  const runtime = resolveJavaScriptRuntime(resolveExecutable);
  const path = resolve(PACKAGE_REL, DIST_CLI_REL);
  return { command: [runtime.command, path, "mcp"], path, exists: runtime.available, runtimeAvailable: runtime.available };
}

function resolveAstGrepCommand(options: AstGrepMcpConfigOptions = {}): CommandCandidate {
  const pathExists = options.exists ?? existsSync;
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable;
  const candidates: CommandCandidate[] = [];
  const seenPaths = new Set<string>();
  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url);
  if (moduleDirectory) addAncestorCommandCandidates(moduleDirectory, candidates, seenPaths, pathExists, resolveExecutable);

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
