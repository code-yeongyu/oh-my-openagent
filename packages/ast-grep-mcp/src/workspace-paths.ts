import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function normalizeWorkspaceDirectory(workspaceDirectory: string): string {
  return realpathSync(resolve(workspaceDirectory));
}

export function resolveWorkspacePaths(rawPaths: readonly string[] | undefined, workspaceDirectory: string): readonly string[] {
  const workspace = normalizeWorkspaceDirectory(workspaceDirectory);
  const requestedPaths = rawPaths && rawPaths.length > 0 ? rawPaths : ["."];
  return requestedPaths.map((rawPath) => resolveWorkspacePath(rawPath, workspace));
}

function resolveWorkspacePath(rawPath: string, workspaceDirectory: string): string {
  if (rawPath.length === 0) throw new Error("paths entries must be non-empty strings");
  if (rawPath.startsWith("-")) throw new Error(`paths entries must not start with '-': ${rawPath}`);
  if (rawPath.includes("\0")) throw new Error("paths entries must not contain null bytes");
  if (isAbsolute(rawPath)) throw new Error(`paths entries must be relative to the workspace: ${rawPath}`);

  const absolutePath = resolve(workspaceDirectory, rawPath);
  assertInsideWorkspace(absolutePath, workspaceDirectory, rawPath);

  if (existsSync(absolutePath)) {
    const realPath = realpathSync(absolutePath);
    assertInsideWorkspace(realPath, workspaceDirectory, rawPath);
  }

  const normalizedPath = relative(workspaceDirectory, absolutePath);
  return normalizedPath === "" ? "." : normalizedPath;
}

function assertInsideWorkspace(candidatePath: string, workspaceDirectory: string, rawPath: string): void {
  const workspaceRelativePath = relative(workspaceDirectory, candidatePath);
  if (workspaceRelativePath === "" || (!workspaceRelativePath.startsWith("..") && !isAbsolute(workspaceRelativePath))) return;
  throw new Error(`paths entries must stay inside the workspace: ${rawPath}`);
}
