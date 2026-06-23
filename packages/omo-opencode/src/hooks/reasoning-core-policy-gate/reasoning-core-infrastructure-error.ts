export function isReasoningCoreInfrastructureError(reason: string | undefined): boolean {
  if (!reason) return false

  return [
    "ENOENT",
    "not found",
    "timed out",
    "initialize failed",
    "call failed",
    "exited before responding",
    "invalid json",
    "empty response",
    "non-json response",
  ].some(pattern => reason.toLowerCase().includes(pattern.toLowerCase()))
}
