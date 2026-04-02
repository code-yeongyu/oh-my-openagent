import { existsSync, realpathSync } from "fs"
import { resolve } from "path"
import type { ClaudeCodeMcpServer } from "./types"

function normalizePath(path: string): string {
  const resolvedPath = resolve(path)

  if (!existsSync(resolvedPath)) {
    return resolvedPath
  }

  return realpathSync(resolvedPath)
}

export function shouldLoadMcpServer(
  server: Pick<ClaudeCodeMcpServer, "scope" | "projectPath">,
  cwd = process.cwd()
): boolean {
  if (server.scope !== "local") {
    return true
  }

  if (!server.projectPath) {
    return false
  }

  return normalizePath(server.projectPath) === normalizePath(cwd)
}
