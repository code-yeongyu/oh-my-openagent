import { runSecurityExplain } from "../../../../omo-native/bin/lib/doctor-security-explain.js"
import type { DoctorOptions } from "./framework/types"
import { runDoctor } from "./runner"
import { PUBLISHED_PACKAGE_NAME } from "../../shared"
import { EXIT_CODES } from "./framework/constants"

export async function doctor(options: DoctorOptions = { mode: "default" }): Promise<number> {
  if (options.explainSecurity) {
    return explainSecurity(options)
  }
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

/**
 * `doctor --explain-security` prints what the security controls are actually doing on this machine
 * and stops there. It is a different output from the check report (prose about state, not pass/fail
 * about health), and it deliberately runs no check: a user who asks what omo is enforcing is not
 * asking for thirty seconds of dependency probing first.
 *
 * The prose itself lives in omo-ai's launcher lib because that is where every security feature in
 * the roadmap reads its state from; each of those PRs extends the same section list.
 */
export function explainSecurity(options: Pick<DoctorOptions, "json"> = {}): number {
  const lines = runSecurityExplain({ env: process.env })
  console.log(options.json ? JSON.stringify(lines, null, 2) : lines.join("\n"))
  return EXIT_CODES.SUCCESS
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