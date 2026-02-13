import type { DoctorOptions } from "./types"
import { runDoctor } from "./runner"

export async function doctor(options: DoctorOptions = { mode: "default" }): Promise<number> {
  const result = await runDoctor(options)
  return result.exitCode
}

export * from "./types"
export { runDoctor } from "./runner"
export { formatDoctorOutput, formatJsonOutput } from "./formatter"
