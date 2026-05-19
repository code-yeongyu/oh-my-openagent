import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalMcpConfig } from "./lsp";

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
};

type CommandCandidate = {
  readonly command: string[];
  readonly path: string;
  readonly exists: boolean;
};

function addAncestorCommandCandidates(
  startDirectory: string,
  target: CommandCandidate[],
  seenPaths: Set<string>,
  pathExists: (path: string) => boolean,
): void {
  let currentDirectory = resolve(startDirectory);
  while (true) {
    const distCliPath = resolve(currentDirectory, PACKAGE_REL, DIST_CLI_REL);
    if (!seenPaths.has(distCliPath)) {
      seenPaths.add(distCliPath);
      target.push({ command: ["node", distCliPath, "mcp"], path: distCliPath, exists: pathExists(distCliPath) });
    }

    const sourceCliPath = resolve(currentDirectory, PACKAGE_REL, SOURCE_CLI_REL);
    if (!seenPaths.has(sourceCliPath)) {
      seenPaths.add(sourceCliPath);
      target.push({ command: ["bun", sourceCliPath, "mcp"], path: sourceCliPath, exists: pathExists(sourceCliPath) });
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

function resolveAstGrepCommand(options: AstGrepMcpConfigOptions = {}): string[] {
  const pathExists = options.exists ?? existsSync;
  const candidates: CommandCandidate[] = [];
  const seenPaths = new Set<string>();
  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url);
  if (moduleDirectory) addAncestorCommandCandidates(moduleDirectory, candidates, seenPaths, pathExists);

  const distCandidate = candidates.find((candidate) => candidate.path.endsWith(DIST_CLI_REL) && candidate.exists);
  if (distCandidate) return distCandidate.command;
  const sourceCandidate = candidates.find((candidate) => candidate.path.endsWith(SOURCE_CLI_REL) && candidate.exists);
  if (sourceCandidate) return sourceCandidate.command;
  return candidates[0]?.command ?? ["node", resolve(PACKAGE_REL, DIST_CLI_REL), "mcp"];
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
  return {
    type: "local",
    command: resolveAstGrepCommand(options),
    enabled: true,
    environment: {
      [WORKSPACE_ENV]: workspaceDirectory,
      [DISABLED_TOOLS_ENV]: astGrepDisabledTools(options.disabledTools),
    },
  };
}
