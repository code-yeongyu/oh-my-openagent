import { deleteToken } from "../../features/mcp-oauth/storage"

export async function logout(serverName: string): Promise<number> {
  try {
    const success = deleteToken(serverName, serverName)

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
