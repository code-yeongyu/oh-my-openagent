import { isRecord } from "../record-type-guard"

export function isPromptMessageInspectionAborted(error: unknown): boolean {
  if (error instanceof Error && error.name === "MessageAbortedError") {
    return true
  }
  return isRecord(error) && error.name === "MessageAbortedError"
}
