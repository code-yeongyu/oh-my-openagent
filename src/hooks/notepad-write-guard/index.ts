import type { Hooks } from "@opencode-ai/plugin"
import { normalize } from "path"

const NOTEPAD_SEGMENT = `${normalize(".sisyphus/notepads")}/`

function isNotebookPath(filePath: string): boolean {
  const normalised = normalize(filePath)
  return normalised.includes(`/.sisyphus/notepads/`) || normalised.startsWith(NOTEPAD_SEGMENT)
}

function resolveFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined
  const a = args as Record<string, unknown>
  const raw = a["filePath"] ?? a["path"] ?? a["file_path"]
  return typeof raw === "string" ? raw : undefined
}

export function createNotepadWriteGuardHook(): Hooks {
  return {
    "tool.execute.before": async (
      input: { tool?: string },
      _output: unknown,
    ): Promise<void> => {
      if (input.tool?.toLowerCase() !== "write") return

      const outputRecord = _output as { args?: unknown } | undefined
      const filePath = resolveFilePath(outputRecord?.args)
      if (!filePath) return

      if (isNotebookPath(filePath)) {
        throw new Error(
          `Refused: Write to ${filePath} is blocked because notepad files are append-only and Write would destroy history. Report the original Edit failure to the user and ask for guidance instead.`,
        )
      }
    },
  }
}
