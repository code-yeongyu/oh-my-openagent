import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Command } from "commander"
import { createMcpOAuthCommand } from "./index"

describe("mcp oauth command", () => {
  let program: Command

  beforeEach(() => {
    program = new Command()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("command structure", () => {
    it("creates mcp command group with oauth subcommand", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()

      // when
      const subcommands = mcpCommand.commands.map((cmd) => cmd.name())

      // then
      expect(subcommands).toContain("oauth")
    })

    it("oauth subcommand has login, logout, and status subcommands", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")

      // when
      const subcommands = oauthCommand?.commands.map((cmd) => cmd.name()) ?? []

      // then
      expect(subcommands).toContain("login")
      expect(subcommands).toContain("logout")
      expect(subcommands).toContain("status")
    })
  })

  describe("login subcommand", () => {
    it("accepts server-name argument", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "login")

      // when
      const args = loginCommand?.args ?? []

      // then
      expect(args.length).toBeGreaterThan(0)
      expect(args[0]?.name()).toBe("server-name")
    })

    it("accepts --server-url option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const serverUrlOption = options.find((opt) => opt.long === "--server-url")

      // then
      expect(serverUrlOption).toBeDefined()
    })

    it("accepts --client-id option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const clientIdOption = options.find((opt) => opt.long === "--client-id")

      // then
      expect(clientIdOption).toBeDefined()
    })

    it("accepts --scopes option", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const loginCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "login")

      // when
      const options = loginCommand?.options ?? []
      const scopesOption = options.find((opt) => opt.long === "--scopes")

      // then
      expect(scopesOption).toBeDefined()
    })
  })

  describe("logout subcommand", () => {
    it("accepts server-name argument", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const logoutCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "logout")

      // when
      const args = logoutCommand?.args ?? []

      // then
      expect(args.length).toBeGreaterThan(0)
      expect(args[0]?.name()).toBe("server-name")
    })
  })

  describe("status subcommand", () => {
    it("accepts optional server-name argument", () => {
      // given
      const mcpCommand = createMcpOAuthCommand()
      const oauthCommand = mcpCommand.commands.find((cmd) => cmd.name() === "oauth")
      const statusCommand = oauthCommand?.commands.find((cmd) => cmd.name() === "status")

      // when
      const args = statusCommand?.args ?? []

      // then
      expect(args.length).toBeGreaterThan(0)
      expect(args[0]?.name()).toMatch(/\[.*\]/) // optional argument
    })
  })
})
