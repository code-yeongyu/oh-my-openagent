import { listTokensByHost, loadToken } from "../../features/mcp-oauth/storage"

export async function status(serverName: string | undefined): Promise<number> {
  try {
    if (serverName) {
      const token = loadToken(serverName, serverName)

      if (!token) {
        console.log(`No tokens found for ${serverName}`)
        return 0
      }

      console.log(`OAuth Status for ${serverName}:`)
      console.log(`  Access Token: ${token.accessToken.slice(0, 20)}...`)
      if (token.refreshToken) {
        console.log(`  Refresh Token: ${token.refreshToken.slice(0, 20)}...`)
      }
      if (token.expiresAt) {
        const expiryDate = new Date(token.expiresAt * 1000)
        const now = Date.now() / 1000
        const isExpired = token.expiresAt < now
        const status = isExpired ? "EXPIRED" : "VALID"
        console.log(`  Expiry: ${expiryDate.toISOString()} (${status})`)
      }
      return 0
    }

    const tokens = listTokensByHost("")
    if (Object.keys(tokens).length === 0) {
      console.log("No OAuth tokens stored")
      return 0
    }

    console.log("Stored OAuth Tokens:")
    for (const [key, token] of Object.entries(tokens)) {
      const isExpired = token.expiresAt && token.expiresAt < Date.now() / 1000
      const status = isExpired ? "EXPIRED" : "VALID"
      console.log(`  ${key}: ${status}`)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: Failed to get token status: ${message}`)
    return 1
  }
}
