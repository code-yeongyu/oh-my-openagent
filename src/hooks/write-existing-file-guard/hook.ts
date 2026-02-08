import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import { existsSync } from "fs"
import { resolve, isAbsolute, join, normalize, sep } from "path"

import { log } from "../../shared"

export function createWriteExistingFileGuardHook(ctx: PluginInput): Hooks {
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool?.toLowerCase()
      if (toolName !== "write") {
        return
      }

      const args = output.args as
        | { filePath?: string; path?: string; file_path?: string }
        | undefined
      const filePath = args?.filePath ?? args?.path ?? args?.file_path
      if (!filePath) {
        return
      }

      const resolvedPath = normalize(
        isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
      )

      if (existsSync(resolvedPath)) {
        const sisyphusRoot = join(ctx.directory, ".sisyphus") + sep
        const isSisyphusMarkdown =
          resolvedPath.startsWith(sisyphusRoot) && resolvedPath.endsWith(".md")
        if (isSisyphusMarkdown) {
          log("[write-existing-file-guard] Allowing .sisyphus/*.md overwrite", {
            sessionID: input.sessionID,
            filePath,
          })
          return
        }

        log("[write-existing-file-guard] Blocking write to existing file", {
          sessionID: input.sessionID,
          filePath,
          resolvedPath,
        })

        throw new Error("File already exists. Use edit tool instead.")
      }
    },
  }
}
