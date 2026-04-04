import { containsPath } from "../../shared/contains-path"
import type { ClaudeCodeMcpServer } from "./types"

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

  return containsPath(server.projectPath, cwd)
}
