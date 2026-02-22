import type { DoctorResult, DoctorMode } from "./types"
import { formatDefault } from "./format-default"
import { formatStatus } from "./format-status"
import { formatVerbose } from "./format-verbose"

export function formatDoctorOutput(result: DoctorResult, mode: DoctorMode): string {
  switch (mode) {
    case "default":
      return formatDefault(result)
    case "status":
      return formatStatus(result)
    case "verbose":
      return formatVerbose(result)
  }
}

export function formatJsonOutput(result: DoctorResult): string {
  return JSON.stringify(result, null, 2)
}
