import { listAllTokens, listTokensByHost } from "../../features/mcp-oauth/storage"

export async function status(serverName: string | undefined): Promise<number> {
  try {
    if (serverName) {
      const tokens = listTokensByHost(serverName)

      if (Object.keys(tokens).length === 0) {
        console.log(`No tokens found for ${serverName}`)
        return 0
      }

      console.log(`OAuth Status for ${serverName}:`)
      for (const [key, token] of Object.entries(tokens)) {
        console.log(`  ${key}:`)
        console.log(`    Access Token: [REDACTED]`)
        if (token.refreshToken) {
          console.log(`    Refresh Token: [REDACTED]`)
        }
        if (token.expiresAt) {
          const expiryDate = new Date(token.expiresAt * 1000)
          const now = Date.now() / 1000
          const isExpired = token.expiresAt < now
          const tokenStatus = isExpired ? "EXPIRED" : "VALID"
          console.log(`    Expiry: ${expiryDate.toISOString()} (${tokenStatus})`)
        }
      }
      return 0
    }

    const tokens = listAllTokens()
    if (Object.keys(tokens).length === 0) {
      console.log("No OAuth tokens stored")
      return 0
    }

    console.log("Stored OAuth Tokens:")
    for (const [key, token] of Object.entries(tokens)) {
      const isExpired = token.expiresAt && token.expiresAt < Date.now() / 1000
      const tokenStatus = isExpired ? "EXPIRED" : "VALID"
      console.log(`  ${key}: ${tokenStatus}`)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: Failed to get token status: ${message}`)
    return 1
  }
}
