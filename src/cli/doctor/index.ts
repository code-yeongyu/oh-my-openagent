import type { DoctorOptions } from "./types"
import { runDoctor } from "./runner"
import { EXIT_CODES } from "./constants"

export async function doctor(options: DoctorOptions = { mode: "default" }): Promise<number> {
  try {
    const result = await runDoctor(options)
    return result.exitCode
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("\nDoctor failed unexpectedly:", message)
    console.error("This may indicate memory pressure (OOM/SIGKILL) or a corrupted installation.")
    console.error("Try: OMO_DISABLE_POSTHOG=1 bunx oh-my-opencode doctor --verbose\n")
    return EXIT_CODES.FAILURE
  }
}

export * from "./types"
export { runDoctor } from "./runner"
export { formatDoctorOutput, formatJsonOutput } from "./formatter"
