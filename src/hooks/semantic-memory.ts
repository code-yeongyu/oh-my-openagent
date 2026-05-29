import { readFileSync, existsSync } from "fs"
import { join, basename } from "path"
import { storeMemory, recordCodeMemory, retrieveCodeMemories } from "../features/semantic-memory"
import { contextCollector } from "../features/context-injector"
import { log } from "../shared/logger"
import { spawnSync } from "../shared/bun-spawn-shim"

// Map of pending file states keyed by callID
const pendingFileStates = new Map<string, { filePath: string; beforeContent: string }>()

export const createSemanticMemoryHook = (ctx: { directory: string }, pluginConfig?: any) => {
  const enabled = pluginConfig?.semantic_memory?.enabled ?? true
  const useAft = pluginConfig?.semantic_memory?.use_aft_precision ?? true

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
            const pathPart = trimmed.substring(2).trim()
            if (pathPart) {
              const fullPath = join(ctx.directory, pathPart)
              if (existsSync(fullPath)) {
                workspaceFiles.push(fullPath)
              }
            }
          }
        }

        // Match files against stored AST pattern memories (capped at 10 files for performance)
        const filesToMatch = workspaceFiles.slice(0, 10)
        if (filesToMatch.length > 0 && useAft) {
          log("[semantic-memory] Matching workspace files against AST pattern memories:", filesToMatch)
          const matches = await retrieveCodeMemories(filesToMatch, { sessionId: input.sessionID })
          
          if (matches.length > 0) {
            log(`[semantic-memory] Found ${matches.length} matching code memories!`)
            
            // Format matched memories as high-relevance context
            let matchedContext = "=== RELEVANT SEMANTIC MEMORIES OF PREVIOUS CODE PATTERNS ===\n"
            for (const match of matches) {
              matchedContext += `\n[Memory Match] File: ${basename(match.matchFile)}\n`
              if (match.entry.symbolName) {
                matchedContext += `Symbol: ${match.entry.symbolName}\n`
              }
              if (match.entry.astPattern) {
                matchedContext += `AST Pattern matched: ${match.entry.astPattern}\n`
              }
              matchedContext += `Explanation/Fix Context:\n${match.entry.content}\n`
              if (match.entry.afterContent) {
                matchedContext += `Correct implementation snippet:\n\`\`\`\n${match.entry.afterContent}\n\`\`\`\n`
              }
              matchedContext += `--------------------------------------------------\n`
            }

            // Register with native contextCollector for seamless message injection!
            contextCollector.register(input.sessionID, {
              id: "semantic_memory_hits",
              source: "semantic_memory",
              content: matchedContext,
              priority: "high",
            })
          }
        }
      } catch (err) {
        log("[semantic-memory] Failed matching turn start memories:", err)
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (!enabled) return

      const toolLower = input.tool.toLowerCase()
      const fileTools = ["write", "edit", "multiedit", "apply_patch", "write_to_file", "replace_file_content", "multi_replace_file_content", "hashline_edit"]
      if (!fileTools.includes(toolLower)) {
        return
      }

      try {
        const rawPath = (output.args?.filePath ??
          output.args?.file_path ??
          output.args?.path ??
          output.args?.TargetFile ??
          output.args?.targetFile) as string | undefined

        if (!rawPath) return

        const filePath = join(ctx.directory, rawPath)
        let beforeContent = ""
        if (existsSync(filePath)) {
          beforeContent = readFileSync(filePath, "utf-8")
        }

        pendingFileStates.set(input.callID, {
          filePath,
          beforeContent,
        })
      } catch (err) {
        log("[semantic-memory] Failed capturing pre-execution state:", err)
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (!enabled) return

      try {
        const pending = pendingFileStates.get(input.callID)
        if (!pending) {
          const importantTools = ["delegate", "task", "skill"]
          if (importantTools.includes(input.tool.toLowerCase())) {
            const toolOutput = output.output?.toString() ?? ""
            if (toolOutput && !toolOutput.includes("Error:")) {
              storeMemory(`Successful execution of ${input.tool}: ${toolOutput.substring(0, 150)}`, {
                sessionId: input.sessionID,
                memoryType: "context",
                importance: 1.2,
              })
            }
          }
          return
        }

        pendingFileStates.delete(input.callID)

        const toolOutput = output.output?.toString() ?? ""
        const outputLower = toolOutput.toLowerCase()
        const isToolFailure =
          outputLower.includes("error:") ||
          outputLower.includes("failed to") ||
          outputLower.includes("could not") ||
          outputLower.startsWith("error")

        if (isToolFailure) {
          log("[semantic-memory] Tool failed, storing error context memory instead")
          storeMemory(`Error in editing file ${basename(pending.filePath)}: ${toolOutput.substring(0, 200)}`, {
            sessionId: input.sessionID,
            memoryType: "error",
            importance: 1.8,
            filePath: pending.filePath,
          })
          return
        }

        if (existsSync(pending.filePath)) {
          const afterContent = readFileSync(pending.filePath, "utf-8")
          if (pending.beforeContent !== afterContent) {
            const explanation = (input.args?.description ??
              input.args?.Description ??
              input.args?.instruction ??
              input.args?.Instruction ??
              input.args?.summary ??
              input.args?.Summary ??
              `Modified ${basename(pending.filePath)}`) as string

            log("[semantic-memory] Code modified. Generating AFT code memory for:", pending.filePath)
            await recordCodeMemory(pending.filePath, pending.beforeContent, afterContent, {
              sessionId: input.sessionID,
              explanation,
            })
          }
        }
      } catch (err) {
        log("[semantic-memory] Failed post-execution memory recording:", err)
      }
    },
  }
}

