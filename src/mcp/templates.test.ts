import { describe, it, expect } from "bun:test"
import {
  getMcpTemplate,
  getAllMcpTemplates,
  resolveMcpFromTemplate,
  type McpTemplateConfig,
  MCP_TEMPLATES,
} from "./templates"

describe("MCP Templates", () => {
  //#region getMcpTemplate
  describe("getMcpTemplate", () => {
    //#given a valid template name
    //#when getMcpTemplate is called
    //#then it should return the template configuration
    it("should return template for valid template name", () => {
      const template = getMcpTemplate("exa")
      expect(template).toBeDefined()
      expect(template?.name).toBe("exa")
      expect(template?.envKey).toBe("EXA_API_KEY")
    })

    //#given an invalid template name
    //#when getMcpTemplate is called
    //#then it should return undefined
    it("should return undefined for invalid template name", () => {
      const template = getMcpTemplate("nonexistent")
      expect(template).toBeUndefined()
    })
  })
  //#endregion

  //#region getAllMcpTemplates
  describe("getAllMcpTemplates", () => {
    //#given the templates module
    //#when getAllMcpTemplates is called
    //#then it should return all available templates
    it("should return all available templates", () => {
      const templates = getAllMcpTemplates()
      expect(templates.length).toBeGreaterThan(0)
      expect(templates.some(t => t.name === "exa")).toBe(true)
    })
  })
  //#endregion

  //#region resolveMcpFromTemplate
  describe("resolveMcpFromTemplate", () => {
    //#given a template name and API key
    //#when resolveMcpFromTemplate is called
    //#then it should return a fully resolved MCP config
    it("should resolve MCP config from template with API key", () => {
      const config: McpTemplateConfig = {
        template: "exa",
        apiKey: "test-api-key-123",
      }
      const result = resolveMcpFromTemplate(config)
      
      expect(result).toBeDefined()
      expect(result?.type).toBe("remote")
      expect(result?.enabled).toBe(true)
      expect(result?.url).toContain("exa.ai")
      expect(result?.headers?.["x-api-key"]).toBe("test-api-key-123")
    })

    //#given a template name without API key but with env var set
    //#when resolveMcpFromTemplate is called
    //#then it should use the environment variable
    it("should resolve MCP config using env var when apiKey not provided", () => {
      const originalEnv = process.env.EXA_API_KEY
      process.env.EXA_API_KEY = "env-api-key-456"
      
      try {
        const config: McpTemplateConfig = {
          template: "exa",
        }
        const result = resolveMcpFromTemplate(config)
        
        expect(result).toBeDefined()
        expect(result?.headers?.["x-api-key"]).toBe("env-api-key-456")
      } finally {
        if (originalEnv !== undefined) {
          process.env.EXA_API_KEY = originalEnv
        } else {
          delete process.env.EXA_API_KEY
        }
      }
    })

    //#given a template that doesn't require auth
    //#when resolveMcpFromTemplate is called without API key
    //#then it should succeed without headers
    it("should resolve MCP config for templates without auth requirement", () => {
      const config: McpTemplateConfig = {
        template: "context7",
      }
      const result = resolveMcpFromTemplate(config)
      
      expect(result).toBeDefined()
      expect(result?.type).toBe("remote")
      expect(result?.enabled).toBe(true)
    })

    //#given an invalid template name
    //#when resolveMcpFromTemplate is called
    //#then it should return undefined
    it("should return undefined for invalid template", () => {
      const config: McpTemplateConfig = {
        template: "nonexistent",
      }
      const result = resolveMcpFromTemplate(config)
      
      expect(result).toBeUndefined()
    })

    //#given a template requiring auth but no API key or env var
    //#when resolveMcpFromTemplate is called
    //#then it should return undefined with warning
    it("should return undefined when auth required but not provided", () => {
      const originalEnv = process.env.EXA_API_KEY
      delete process.env.EXA_API_KEY
      
      try {
        const config: McpTemplateConfig = {
          template: "exa",
        }
        const result = resolveMcpFromTemplate(config)
        
        expect(result).toBeUndefined()
      } finally {
        if (originalEnv !== undefined) {
          process.env.EXA_API_KEY = originalEnv
        }
      }
    })
  })
  //#endregion

  //#region MCP_TEMPLATES structure
  describe("MCP_TEMPLATES", () => {
    //#given the MCP_TEMPLATES constant
    //#when inspecting it
    //#then each template should have required fields
    it("should have required fields for each template", () => {
      for (const template of Object.values(MCP_TEMPLATES)) {
        expect(template.name).toBeDefined()
        expect(typeof template.name).toBe("string")
        expect(template.url).toBeDefined()
        expect(typeof template.url).toBe("string")
        expect(template.description).toBeDefined()
        expect(typeof template.description).toBe("string")
        expect(typeof template.requiresAuth).toBe("boolean")
      }
    })

    //#given templates that require auth
    //#when inspecting them
    //#then they should have envKey and headerKey defined
    it("should have envKey and headerKey for auth-required templates", () => {
      for (const template of Object.values(MCP_TEMPLATES)) {
        if (template.requiresAuth) {
          expect(template.envKey).toBeDefined()
          expect(template.headerKey).toBeDefined()
        }
      }
    })
  })
  //#endregion
})
