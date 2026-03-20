import { describe, it, expect } from "bun:test"
import { Command } from "commander"
import { createMcpOAuthCommand } from "./index"

describe("mcp oauth command", () => {

  describe("command structure", () => {
    it("creates mcp command group with oauth subcommand", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()

      // when
      const subcommands = mcpCommand.commands.map((cmd: Command) => cmd.name())

      // then
      expect(subcommands).toContain("oauth")
    })

    it("oauth subcommand has login, logout, and status subcommands", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")

      // when
      const subcommands = oauthCommand?.commands.map((cmd: Command) => cmd.name()) ?? []

      // then
      expect(subcommands).toContain("login")
      expect(subcommands).toContain("logout")
      expect(subcommands).toContain("status")
    })
  })

  describe("login subcommand", () => {
    it("exists and has description", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "login")

      // when
      const description = loginCommand?.description() ?? ""

      // then
      expect(loginCommand).toBeDefined()
      expect(description).toContain("OAuth")
    })

    it("accepts --server-url option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const serverUrlOption = options.find((opt: { long?: string }) => opt.long === "--server-url")

      // then
      expect(serverUrlOption).toBeDefined()
    })

    it("accepts --client-id option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const clientIdOption = options.find((opt: { long?: string }) => opt.long === "--client-id")

      // then
      expect(clientIdOption).toBeDefined()
    })

    it("accepts --scopes option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const scopesOption = options.find((opt: { long?: string }) => opt.long === "--scopes")

      // then
      expect(scopesOption).toBeDefined()
    })
  })

  describe("logout subcommand", () => {
    it("exists and has description", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const logoutCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "logout")

      // when
      const description = logoutCommand?.description() ?? ""

      // then
      expect(logoutCommand).toBeDefined()
      expect(description).toContain("tokens")
    })
  })

  describe("status subcommand", () => {
    it("exists and has description", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd: Command) => cmd.name() === "oauth")
      const statusCommand = oauthCommand?.commands.find((cmd: Command) => cmd.name() === "status")

      // when
      const description = statusCommand?.description() ?? ""

      // then
      expect(statusCommand).toBeDefined()
      expect(description).toContain("status")
    })
  })
})
