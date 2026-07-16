import { describe, it, expect } from "bun:test"
import {
  OpenVikingConfigSchema,
  validateOpenVikingConfig,
  isOpenVikingEnabled,
  DEFAULT_OPENVIKING_CONFIG,
  type OpenVikingConfig,
} from "./openviking"

describe("OpenVikingConfigSchema", () => {
  describe("default configuration", () => {
    it("should use default values when no config provided", () => {
      const config = OpenVikingConfigSchema.parse({})
      
      expect(config.enabled).toBe(false)
      expect(config.url).toBe("http://localhost:1933")
      expect(config.api_key).toBe("")
      expect(config.auto_recall).toBe(true)
      expect(config.auto_commit).toBe(true)
      expect(config.max_memories).toBe(5)
      expect(config.memory_types).toBeUndefined()
    })

    it("should match DEFAULT_OPENVIKING_CONFIG", () => {
      const config = OpenVikingConfigSchema.parse({})
      
      expect(config).toEqual(DEFAULT_OPENVIKING_CONFIG)
    })
  })

  describe("custom configuration", () => {
    it("should accept valid custom configuration", () => {
      const customConfig = {
        enabled: true,
        url: "https://openviking.example.com",
        api_key: "test-api-key",
        auto_recall: false,
        auto_commit: false,
        max_memories: 10,
        memory_types: ["preferences", "patterns"],
      }
      
      const config = OpenVikingConfigSchema.parse(customConfig)
      
      expect(config.enabled).toBe(true)
      expect(config.url).toBe("https://openviking.example.com")
      expect(config.api_key).toBe("test-api-key")
      expect(config.auto_recall).toBe(false)
      expect(config.auto_commit).toBe(false)
      expect(config.max_memories).toBe(10)
      expect(config.memory_types).toEqual(["preferences", "patterns"])
    })

    it("should accept partial configuration", () => {
      const partialConfig = {
        enabled: true,
        max_memories: 3,
      }
      
      const config = OpenVikingConfigSchema.parse(partialConfig)
      
      expect(config.enabled).toBe(true)
      expect(config.url).toBe("http://localhost:1933") // default
      expect(config.max_memories).toBe(3)
    })
  })

  describe("validation errors", () => {
    it("should reject invalid URL", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          url: "not-a-valid-url",
        })
      }).toThrow()
    })

    it("should reject max_memories less than 1", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          max_memories: 0,
        })
      }).toThrow()
    })

    it("should reject max_memories greater than 20", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          max_memories: 21,
        })
      }).toThrow()
    })

    it("should reject non-integer max_memories", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          max_memories: 5.5,
        })
      }).toThrow()
    })

    it("should reject invalid memory types", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          memory_types: ["invalid_type"],
        })
      }).toThrow()
    })

    it("should reject unknown fields", () => {
      expect(() => {
        OpenVikingConfigSchema.parse({
          unknown_field: "value",
        })
      }).toThrow()
    })
  })

  describe("memory types", () => {
    it("should accept all valid memory types", () => {
      const allTypes = [
        "profile",
        "preferences",
        "entities",
        "events",
        "cases",
        "patterns",
        "tools",
        "skills",
      ]
      
      const config = OpenVikingConfigSchema.parse({
        memory_types: allTypes,
      })
      
      expect(config.memory_types).toEqual(allTypes)
    })

    it("should accept empty memory types array", () => {
      const config = OpenVikingConfigSchema.parse({
        memory_types: [],
      })
      
      expect(config.memory_types).toEqual([])
    })
  })
})

describe("validateOpenVikingConfig", () => {
  it("should validate and return config", () => {
    const input = {
      enabled: true,
      max_memories: 8,
    }
    
    const config = validateOpenVikingConfig(input)
    
    expect(config.enabled).toBe(true)
    expect(config.max_memories).toBe(8)
  })

  it("should throw on invalid config", () => {
    expect(() => {
      validateOpenVikingConfig({
        max_memories: 100,
      })
    }).toThrow()
  })
})

describe("isOpenVikingEnabled", () => {
  it("should return true when enabled", () => {
    const config: OpenVikingConfig = {
      ...DEFAULT_OPENVIKING_CONFIG,
      enabled: true,
    }
    
    expect(isOpenVikingEnabled(config)).toBe(true)
  })

  it("should return false when disabled", () => {
    const config: OpenVikingConfig = {
      ...DEFAULT_OPENVIKING_CONFIG,
      enabled: false,
    }
    
    expect(isOpenVikingEnabled(config)).toBe(false)
  })

  it("should return false when config is undefined", () => {
    expect(isOpenVikingEnabled(undefined)).toBe(false)
  })
})
