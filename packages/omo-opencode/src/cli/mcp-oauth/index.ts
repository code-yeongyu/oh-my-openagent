import { Command } from "commander"
import { login } from "./login"
import { logout } from "./logout"
import { status } from "./status"

export function createMcpOAuthCommand(): Command {
  const mcp = new Command("mcp").description("MCP server management")

  const oauth = new Command("oauth").description("OAuth token management for MCP servers")

  oauth
    .command("login <server-name>")
    .description("Authenticate with an MCP server using OAuth")
    .option("--server-url <url>", "OAuth server URL (required if not in config)")
    .option("--client-id <id>", "OAuth client ID (optional, uses DCR if not provided)")
    .option("--scopes <scopes...>", "OAuth scopes to request")
    .action(async (serverName: string, options) => {
      const exitCode = await login(serverName, options)
      process.exit(exitCode)
    })

  oauth
    .command("logout <server-name>")
    .description("Remove stored OAuth tokens for an MCP server")
    .option("--server-url <url>", "OAuth server URL (use if server name differs from URL)")
    .action(async (serverName: string, options) => {
      const exitCode = await logout(serverName, options)
      process.exit(exitCode)
    })

  oauth
    .command("status [server-name]")
    .description("Show OAuth token status for MCP servers")
    .action(async (serverName: string | undefined) => {
      const exitCode = await status(serverName)
      process.exit(exitCode)
    })

  mcp.addCommand(oauth)
  return mcp
}

export { login, logout, status }
