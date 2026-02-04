import { McpOAuthProvider } from "../../features/mcp-oauth/provider"

export interface LoginOptions {
  serverUrl?: string
  clientId?: string
  scopes?: string[]
}

export async function login(serverName: string, options: LoginOptions): Promise<number> {
  try {
    const serverUrl = options.serverUrl
    if (!serverUrl) {
      console.error(`Error: --server-url is required for server "${serverName}"`)
      return 1
    }

    const provider = new McpOAuthProvider({
      serverUrl,
      clientId: options.clientId,
      scopes: options.scopes,
    })

    console.log(`Authenticating with ${serverName}...`)
    const tokenData = await provider.login()

    console.log(`✓ Successfully authenticated with ${serverName}`)
    if (tokenData.expiresAt) {
      const expiryDate = new Date(tokenData.expiresAt * 1000)
      console.log(`  Token expires at: ${expiryDate.toISOString()}`)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: Failed to authenticate with ${serverName}: ${message}`)
    return 1
  }
}
