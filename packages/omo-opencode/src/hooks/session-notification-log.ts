import { log } from "../shared"

export function logCommandFailure(commandName: string, error: Error | string): void {
  log("[session-notification] notification command failed", {
    commandName,
    error: typeof error === "string" ? error : error.message,
  })
}

export function logOperationFailure(operation: string, error: Error | string): void {
  log("[session-notification] notification operation failed", {
    operation,
    error: typeof error === "string" ? error : error.message,
  })
}
