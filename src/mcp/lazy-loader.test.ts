import { describe, it, expect, beforeEach } from "bun:test"
import {
  createLazyMcpRegistry,
  type LazyMcpRegistry,
  type LazyMcpConfig,
} from "./lazy-loader"

describe("LazyMcpLoader", () => {
  let registry: LazyMcpRegistry

  //#given a lazy MCP configuration
  const lazyConfig: LazyMcpConfig = {
    name: "test-mcp",
    type: "remote",
    url: "https://mcp.example.com/mcp",
    lazy: true,
    enabled: true,
  }

  const eagerConfig: LazyMcpConfig = {
    name: "eager-mcp",
    type: "remote",
    url: "https://mcp.eager.com/mcp",
    lazy: false,
    enabled: true,
  }

  beforeEach(() => {
    registry = createLazyMcpRegistry()
  })

  describe("registration", () => {
    //#when registering a lazy MCP
    //#then it should only store metadata, not load the MCP
    it("should not load MCP on registration when lazy=true", () => {
      registry.register(lazyConfig)

      const status = registry.getStatus("test-mcp")
      expect(status).toBeDefined()
      expect(status?.loaded).toBe(false)
      expect(status?.lazy).toBe(true)
    })

    //#when registering an eager MCP
    //#then it should be marked as loaded immediately
    it("should mark MCP as loaded immediately when lazy=false", () => {
      registry.register(eagerConfig)

      const status = registry.getStatus("eager-mcp")
      expect(status).toBeDefined()
      expect(status?.loaded).toBe(true)
      expect(status?.lazy).toBe(false)
    })
  })

  describe("lazy loading", () => {
    //#given a registered lazy MCP
    //#when requesting the MCP config
    //#then it should load and return the full config
    it("should load MCP on first access", async () => {
      registry.register(lazyConfig)

      const config = await registry.get("test-mcp")

      expect(config).toBeDefined()
      expect(config?.url).toBe("https://mcp.example.com/mcp")

      const status = registry.getStatus("test-mcp")
      expect(status?.loaded).toBe(true)
    })

    //#when accessing the same MCP multiple times
    //#then it should return cached config without reloading
    it("should return cached config on subsequent access", async () => {
      registry.register(lazyConfig)

      const config1 = await registry.get("test-mcp")
      const config2 = await registry.get("test-mcp")

      expect(config1).toBe(config2)
    })

    //#when requesting a non-existent MCP
    //#then it should return undefined
    it("should return undefined for non-existent MCP", async () => {
      const config = await registry.get("non-existent")
      expect(config).toBeUndefined()
    })
  })

  describe("getAllLoaded", () => {
    //#when getting all loaded MCPs
    //#then it should only return MCPs that have been loaded
    it("should return only loaded MCPs", async () => {
      registry.register(lazyConfig)
      registry.register(eagerConfig)

      // Before loading lazy MCP
      let loaded = registry.getAllLoaded()
      expect(Object.keys(loaded)).toHaveLength(1)
      expect(loaded["eager-mcp"]).toBeDefined()

      // After loading lazy MCP
      await registry.get("test-mcp")
      loaded = registry.getAllLoaded()
      expect(Object.keys(loaded)).toHaveLength(2)
      expect(loaded["test-mcp"]).toBeDefined()
    })
  })

  describe("error handling", () => {
    //#when MCP loading fails
    //#then it should mark as failed and return error info
    it("should handle loading errors gracefully", async () => {
      const failingConfig: LazyMcpConfig = {
        name: "failing-mcp",
        type: "remote",
        url: "", // Invalid URL
        lazy: true,
        enabled: true,
        validator: () => {
          throw new Error("Connection failed")
        },
      }

      registry.register(failingConfig)

      const config = await registry.get("failing-mcp")
      expect(config).toBeUndefined()

      const status = registry.getStatus("failing-mcp")
      expect(status?.error).toBeDefined()
      expect(status?.error).toContain("Connection failed")
    })
  })

  describe("configuration options", () => {
    //#when configuring lazy loading for specific MCPs
    //#then it should respect the configuration
    it("should support configuring which MCPs use lazy loading", () => {
      const configs: LazyMcpConfig[] = [
        { ...lazyConfig, name: "mcp1", lazy: true },
        { ...lazyConfig, name: "mcp2", lazy: false },
        { ...lazyConfig, name: "mcp3", lazy: true },
      ]

      for (const config of configs) {
        registry.register(config)
      }

      expect(registry.getStatus("mcp1")?.lazy).toBe(true)
      expect(registry.getStatus("mcp2")?.lazy).toBe(false)
      expect(registry.getStatus("mcp3")?.lazy).toBe(true)
    })
  })
})
