import { runDoctor } from "./runner"
import type { DoctorOptions } from "./types"

export async function doctor(options: DoctorOptions = { mode: "default" }): Promise<number> {
  const result = await runDoctor(options)
  return result.exitCode
}

export { formatDoctorOutput, formatJsonOutput } from "./formatter"
export { runDoctor } from "./runner"
export * from "./types"
