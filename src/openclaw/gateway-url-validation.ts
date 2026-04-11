export function validateGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return true
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname === "[::1]")
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}
