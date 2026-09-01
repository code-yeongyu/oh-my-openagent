import type { DoctorOptions } from "./framework/types"
import { runDoctor } from "./runner"
import { PUBLISHED_PACKAGE_NAME } from "../../shared"
import { EXIT_CODES } from "./framework/constants"

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
  lines.push(`Try: OMO_DISABLE_POSTHOG=1 bunx ${PUBLISHED_PACKAGE_NAME} doctor --verbose\n`)
  return lines
}

export * from "./framework/types"
export { runDoctor } from "./runner"
export { resolveDoctorTarget } from "./framework/doctor-target"
export { formatDoctorOutput, formatJsonOutput } from "./framework/formatter"
