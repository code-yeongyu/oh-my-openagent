import { existsSync } from "fs"
import { join } from "path"
import { extractMagicContextForFiles } from "../features/magic-context"
import { contextCollector } from "../features/context-injector"
import { log } from "../shared/logger"
import { spawnSync } from "../shared/bun-spawn-shim"

export const createMagicContextHook = (ctx: { directory: string }, pluginConfig?: any) => {
  const enabled = pluginConfig?.magic_context?.enabled ?? true
  const useAft = pluginConfig?.magic_context?.use_aft_extraction ?? true
  const maxTokens = pluginConfig?.magic_context?.max_context_tokens ?? 4096
  const excludePaths = pluginConfig?.magic_context?.exclude_paths ?? []

  return {
    "chat.message": async (input: { sessionID: string }) => {
      if (!enabled) return

      try {
        // Run a fast, non-blocking git command to locate modified files in the workspace
        const gitStatus = spawnSync(["git", "status", "--porcelain"], { cwd: ctx.directory })
        const workspaceFiles: string[] = []
        if (gitStatus.success && gitStatus.stdout) {
          const lines = gitStatus.stdout.toString().split("\n")
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            // Parse git status porcelain (first 2 characters are status flags)
            const pathPart = trimmed.substring(2).trim()
            if (pathPart) {
              const fullPath = join(ctx.directory, pathPart)
              if (existsSync(fullPath)) {
                workspaceFiles.push(fullPath)
              }
            }
          }
        }

        // Limit to top 10 modified files for performance
        const filesToExtract = workspaceFiles.slice(0, 10)
        if (filesToExtract.length > 0) {
          log(`[magic-context] Extracting structural context for ${filesToExtract.length} modified workspace files`)
          
          let matchedContext = ""
          if (useAft) {
            matchedContext = await extractMagicContextForFiles(filesToExtract, {
              maxTokens,
              excludePaths,
              workspaceDir: ctx.directory,
            })
          }

          if (matchedContext && matchedContext.trim()) {
            const heading = "=== WORKSPACE SURGICAL CLASS & INTERFACE SIGNATURES ===\n" +
              "The following block contains syntax-aware structural skeletons of the modified workspace files. " +
              "Use these class, function, and interface layouts for high-precision design and imports.\n"
            
            const finalContent = heading + matchedContext

            // Register with OMO's native contextCollector for seamless message injection
            contextCollector.register(input.sessionID, {
              id: "magic_context_signatures",
              source: "magic_context",
              content: finalContent,
              priority: "high",
            })
            log(`[magic-context] Successfully registered surgical signatures to context collector for session: ${input.sessionID}`)
          }
        }
      } catch (err) {
        log("[magic-context] Failed turn start magic context extraction:", err)
      }
    },
  }
}
