import { describe, expect, it } from "bun:test"
import { migrateMcpConfig } from "./migrate-mcp"

describe("migrateMcpConfig", () => {
  describe("#given a local 1.x MCP entry", () => {
    it("#when migrated #then command, cwd and environment carry over and enabled inverts to disabled", () => {
      // given
      const v1 = { type: "local", command: ["node", "server.mjs"], cwd: "/srv", environment: { KEY: "v" }, enabled: false }

      // when
      const migrated = migrateMcpConfig(v1)

      // then
      expect(migrated).toEqual({
        type: "local",
        command: ["node", "server.mjs"],
        cwd: "/srv",
        environment: { KEY: "v" },
        disabled: true,
        codemode: false,
      })
    })

    it("#when enabled is not stated #then disabled is not stated either", () => {
      // given / when
      const migrated = migrateMcpConfig({ type: "local", command: ["node", "s.mjs"] })

      // then
      expect(migrated && "disabled" in migrated).toBe(false)
    })
  })

  describe("#given a remote 1.x MCP entry", () => {
    it("#when migrated #then url and headers carry over and a numeric timeout fills catalog and execution", () => {
      // given
      const v1 = { type: "remote", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" }, timeout: 15_000 }

      // when
      const migrated = migrateMcpConfig(v1)

      // then
      expect(migrated).toEqual({
        type: "remote",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer x" },
        timeout: { catalog: 15_000, execution: 15_000 },
        codemode: false,
      })
    })

    it("#when oauth credentials use camelCase #then they become snake_case fields", () => {
      // given
      const v1 = {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        oauth: { clientId: "id", clientSecret: "secret", scope: "read", callbackPort: 8765, redirectUri: "http://127.0.0.1/cb" },
      }

      // when
      const migrated = migrateMcpConfig(v1)

      // then
      expect(migrated).toMatchObject({
        oauth: { client_id: "id", client_secret: "secret", scope: "read", callback_port: 8765, redirect_uri: "http://127.0.0.1/cb" },
      })
    })

    it("#when oauth is false #then oauth stays disabled", () => {
      // given / when
      const migrated = migrateMcpConfig({ type: "remote", url: "https://mcp.example.com/mcp", oauth: false })

      // then
      expect(migrated).toMatchObject({ oauth: false })
    })
  })

  describe("#given an entry 2.x cannot represent", () => {
    it("#when the type is unknown or the entry is not an object #then nothing is produced", () => {
      // given / when / then
      expect(migrateMcpConfig({ type: "sse", url: "https://x" })).toBeUndefined()
      expect(migrateMcpConfig("not an object")).toBeUndefined()
      expect(migrateMcpConfig({ type: "local" })).toBeUndefined()
      expect(migrateMcpConfig({ type: "remote" })).toBeUndefined()
    })
  })
})
