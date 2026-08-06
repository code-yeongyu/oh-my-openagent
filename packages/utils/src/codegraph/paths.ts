import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

export interface CodegraphWorkspacePaths {
  readonly dataDir: string
  readonly dataRoot: string
  readonly projectLink: string
}

export function sanitizeBase(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-")
  return sanitized.length > 0 ? sanitized : "workspace"
}

export function codegraphDataRoot(homeDir: string): string {
  return join(homeDir, ".omo", "codegraph")
}

export function canonicalizeCodegraphPath(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch (error) {
    if (error instanceof Error) return resolved
    throw error
  }
}

function workspaceStorageName(workspace: string): string {
  const resolved = canonicalizeCodegraphPath(workspace)
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16)
  return `${sanitizeBase(basename(resolved))}-${hash}`
}

export function resolveCodegraphWorkspacePaths(
  workspace: string,
  options: { readonly homeDir?: string } = {},
): CodegraphWorkspacePaths {
  const resolvedWorkspace = canonicalizeCodegraphPath(workspace)
  const dataRoot = codegraphDataRoot(options.homeDir ?? homedir())
  return {
    dataDir: join(dataRoot, "projects", workspaceStorageName(resolvedWorkspace)),
    dataRoot,
    projectLink: join(resolvedWorkspace, ".codegraph"),
  }
}
