import { homedir } from "os"
import { join } from "path"
import { containsPath } from "../../shared/contains-path"
import type { PluginInstallation } from "./types"

function expandTilde(inputPath: string): string {
  if (inputPath === "~") {
    return homedir()
  }
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return join(homedir(), inputPath.slice(2))
  }
  return inputPath
}

export function shouldLoadPluginForCwd(
  installation: Pick<PluginInstallation, "scope" | "projectPath">,
  cwd: string = process.cwd(),
): boolean {
  if (installation.scope !== "project" && installation.scope !== "local") {
    return true
  }

  if (!installation.projectPath) {
    return false
  }

  return containsPath(expandTilde(installation.projectPath), cwd)
}
