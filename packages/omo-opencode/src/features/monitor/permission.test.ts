import { describe, expect, test } from "bun:test"

import { checkMonitorCommandPermission, type MonitorConfig } from "./permission"

function createConfig(input: Partial<MonitorConfig>): MonitorConfig {
  return {
    enabled: true,
    ...input,
  }
}

describe("checkMonitorCommandPermission", () => {
  describe("#given monitor is disabled", () => {
    test("#when checking any command #then it denies via feature-disabled", async () => {
      // given
      const config = createConfig({ enabled: false, allowed_commands: ["bun"] })

      // when
      const result = await checkMonitorCommandPermission("bun test", { config })

      // then
      expect(result).toEqual({
        allowed: false,
        reason: "monitor feature disabled",
        via: "feature-disabled",
      })
    })
  })

  describe("#given bun is allowlisted", () => {
    test("#when checking bun test #then it allows via allowlist", async () => {
      // given
      const config = createConfig({ allowed_commands: ["bun"] })

      // when
      const result = await checkMonitorCommandPermission("bun test", { config })

      // then
      expect(result).toEqual({
        allowed: true,
        reason: "command allowed by allowed_commands",
        via: "allowlist",
      })
    })
  })

  describe("#given bun is allowlisted", () => {
    test("#when checking npm test #then it denies via allowlist", async () => {
      // given
      const config = createConfig({ allowed_commands: ["bun"] })

      // when
      const result = await checkMonitorCommandPermission("npm test", { config })

      // then
      expect(result).toEqual({
        allowed: false,
        reason: "command not in allowed_commands",
        via: "allowlist",
      })
    })
  })

  describe("#given allowed_commands is empty", () => {
    test("#when checking any command #then it denies via allowlist", async () => {
      // given
      const config = createConfig({ allowed_commands: [] })

      // when
      const result = await checkMonitorCommandPermission("bun test", { config })

      // then
      expect(result).toEqual({
        allowed: false,
        reason: "command not in allowed_commands",
        via: "allowlist",
      })
    })
  })

  describe("#given allowed_commands is undefined", () => {
    test("#when checking any command #then it denies via allowlist", async () => {
      // given
      const config = createConfig({ allowed_commands: undefined })

      // when
      const result = await checkMonitorCommandPermission("bun test", { config })

      // then
      expect(result).toEqual({
        allowed: false,
        reason: "command not in allowed_commands",
        via: "allowlist",
      })
    })
  })

  describe("#given Bash-equivalent permission allows", () => {
    test("#when checking an unlisted command #then it allows via bash-equivalent", async () => {
      // given
      const config = createConfig({ allowed_commands: ["bun"] })

      // when
      const result = await checkMonitorCommandPermission("npm test", {
        config,
        bashPermissionAsk: async () => {},
      })

      // then
      expect(result).toEqual({
        allowed: true,
        reason: "command allowed by bash permission",
        via: "bash-equivalent",
      })
    })
  })

  describe("#given Bash-equivalent permission denies", () => {
    test("#when checking an allowlisted command #then it denies via bash-equivalent", async () => {
      // given
      const config = createConfig({ allowed_commands: ["bun"] })

      // when
      const result = await checkMonitorCommandPermission("bun test", {
        config,
        bashPermissionAsk: async () => {
          throw new Error("blocked by bash policy")
        },
      })

      // then
      expect(result).toEqual({
        allowed: false,
        reason: "blocked by bash policy",
        via: "bash-equivalent",
      })
    })
  })

  describe("#given the first token is quoted", () => {
    test("#when checking a matching command #then it allows via allowlist", async () => {
      // given
      const config = createConfig({ allowed_commands: ["bun test"] })

      // when
      const result = await checkMonitorCommandPermission('"bun test" --watch', { config })

      // then
      expect(result).toEqual({
        allowed: true,
        reason: "command allowed by allowed_commands",
        via: "allowlist",
      })
    })
  })
})
