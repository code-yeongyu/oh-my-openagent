const HOST_TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTCONN",
  "EPIPE",
  "ETIMEDOUT",
])

export function isHostTransportError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return typeof error.code === "string" && HOST_TRANSPORT_ERROR_CODES.has(error.code)
}
