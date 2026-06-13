import type { DoctorOptions } from "./types"
import { runDoctor } from "./runner"
import { EXIT_CODES } from "./constants"

export async function doctor(options: DoctorOptions = { mode: "default" }): Promise<number> {
  try {
    const result = await runDoctor(options)
    return result.exitCode
  } catch (error) {
    for (const line of formatDoctorFailure(error)) {
      console.error(line)
    }
    return EXIT_CODES.FAILURE
  }
}

export function formatDoctorFailure(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error)
  const lines = [`\nDoctor failed unexpectedly: ${message}`]
  if (error instanceof Error && error.stack) {
    lines.push(error.stack)
  }
  lines.push("Try: OMO_DISABLE_POSTHOG=1 bunx oh-my-opencode doctor --verbose\n")
  return lines
}

export * from "./types"
export { runDoctor } from "./runner"
export { resolveDoctorTarget } from "./doctor-target"
export { formatDoctorOutput, formatJsonOutput } from "./formatter"
