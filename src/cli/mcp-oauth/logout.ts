import { deleteToken } from "../../features/mcp-oauth/storage"

export interface LogoutOptions {
  serverUrl?: string
}

export async function logout(serverName: string, options?: LogoutOptions): Promise<number> {
  try {
    const serverUrl = options?.serverUrl
    if (!serverUrl) {
      console.error(`Error: --server-url is required for logout. Token storage uses server URLs, not names.`)
      console.error(`  Usage: mcp oauth logout ${serverName} --server-url https://your-server.example.com`)
      return 1
    }

    const success = deleteToken(serverUrl, serverUrl)

    if (success) {
      console.log(`✓ Successfully removed tokens for ${serverName}`)
      return 0
    }

    console.error(`Error: Failed to remove tokens for ${serverName}`)
    return 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: Failed to remove tokens for ${serverName}: ${message}`)
    return 1
  }
}
