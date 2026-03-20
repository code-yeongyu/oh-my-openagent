import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"

export interface ClaudeBinaryDiagnostics {
  activePath: string | null
  discoveredPaths: string[]
  hasConflict: boolean
}

export interface CommandExecutionResult {
  exitCode: number | null
  stdout: string
}

export type CommandExecutor = (command: string[]) => Promise<CommandExecutionResult>

const LOOKUP_COMMAND_CANDIDATES = [
  ["where", "claude"],
  ["which", "-a", "claude"],
  ["which", "claude"],
]

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

export function parseLookupOutput(output: string): string[] {
  return uniquePaths(output.split(/\r?\n/))
}

export async function resolveClaudeBinaryDiagnostics(
  executeCommand: CommandExecutor,
): Promise<ClaudeBinaryDiagnostics> {
  for (const command of LOOKUP_COMMAND_CANDIDATES) {
    try {
      const result = await executeCommand(command)
      if (result.exitCode !== 0) continue

      const discoveredPaths = parseLookupOutput(result.stdout)
      if (discoveredPaths.length === 0) continue

      return {
        activePath: discoveredPaths[0] ?? null,
        discoveredPaths,
        hasConflict: discoveredPaths.length > 1,
      }
    } catch {
      continue
    }
  }

  return {
    activePath: null,
    discoveredPaths: [],
    hasConflict: false,
  }
}

export async function executeLookupCommand(command: string[]): Promise<CommandExecutionResult> {
  const proc = spawnWithWindowsHide(command, { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return { exitCode: proc.exitCode, stdout }
}
