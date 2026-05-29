// comment-checker-disable-file
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { isAbsolute, normalize, resolve } from "path"
import { bunWhich } from "../../shared/bun-which-shim"
import { spawn } from "../../shared/bun-spawn-shim"

const activePlanningWrites = new Map<string, string>()

function getTargetFileFromArgs(args: any): string | null {
  if (!args) return null
  return args.TargetFile || args.filePath || args.file_path || args.Target || null
}

function resolveInputPath(directory: string, inputPath: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(directory, inputPath))
}

export function createPlannotatorGateHook(ctx: PluginInput): Hooks {
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool?.toLowerCase()
      if (
        toolName !== "write_to_file" &&
        toolName !== "replace_file_content" &&
        toolName !== "multi_replace_file_content" &&
        toolName !== "edit"
      ) {
        return
      }

      const args = output?.args as any
      const targetFile = getTargetFileFromArgs(args)
      if (!targetFile) return

      if (targetFile.endsWith("implementation_plan.md")) {
        const resolvedPath = resolveInputPath(ctx.directory, targetFile)
        activePlanningWrites.set(input.callID, resolvedPath)
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!activePlanningWrites.has(input.callID)) return

      const planPath = activePlanningWrites.get(input.callID)
      activePlanningWrites.delete(input.callID)

      if (!planPath || !existsSync(planPath)) return

      // Verify if plannotator CLI is available on PATH
      const plannotatorBinary = bunWhich("plannotator")
      if (!plannotatorBinary) {
        output.output += `\n\n🎨 [Plannotator Note]\nInstall Plannotator CLI to unlock premium visual plan annotation in your browser:\nWindows PowerShell: irm https://plannotator.ai/install.ps1 | iex\n`
        return
      }

      try {
        // Launch plannotator visual editor on the plan in the background (detached)
        spawn(["plannotator", "annotate", planPath], {
          stdout: "ignore",
          stderr: "ignore",
        })

        output.output += `\n\n🎨 [PLANNOTATOR INTERCEPTION]\nOpened Plannotator in your browser.\nFile: ${planPath}\nPlease review, add visual inline annotations or strikethroughs, and click Save in your browser.\n`
      } catch (err) {
        output.output += `\n\n🎨 [PLANNOTATOR ERROR]\nFailed to launch Plannotator: ${err instanceof Error ? err.message : String(err)}\n`
      }
    },
  }
}
