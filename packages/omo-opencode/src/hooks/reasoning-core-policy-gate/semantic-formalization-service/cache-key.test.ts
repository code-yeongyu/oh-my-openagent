import { describe, expect, it } from "bun:test"
import { createCacheKeyGenerator } from "./cache-key"

describe("createCacheKeyGenerator", () => {
  describe("#given same inputs twice", () => {
    it("#when generate #then returns identical keys", () => {
      const generator = createCacheKeyGenerator()
      const request = {
        problem_statement: "problem",
        options: ["A", "B"],
        metadata: { threshold: 0.5, enabled: true },
      }
      const versions = {
        modelId: "m",
        modelVersion: "v1",
        promptVersion: "1.0",
        schemaVersion: 1,
        mode: "permissive" as const,
      }

      expect(generator.generate(request, versions)).toBe(generator.generate(request, versions))
    })
  })

  describe("#given different model_id", () => {
    it("#when generate #then returns different key", () => {
      const generator = createCacheKeyGenerator()
      const request = { problem_statement: "problem", options: ["A", "B"] }
      const baseVersions = {
        promptVersion: "1.0",
        schemaVersion: 1,
        mode: "permissive" as const,
      }

      expect(
        generator.generate(request, { ...baseVersions, modelId: "model-a" }),
      ).not.toBe(generator.generate(request, { ...baseVersions, modelId: "model-b" }))
    })
  })

  describe("#given different prompt_version", () => {
    it("#when generate #then returns different key", () => {
      const generator = createCacheKeyGenerator()
      const request = { problem_statement: "problem", options: ["A", "B"] }
      const baseVersions = {
        modelId: "m",
        schemaVersion: 1,
        mode: "permissive" as const,
      }

      expect(
        generator.generate(request, { ...baseVersions, promptVersion: "1.0" }),
      ).not.toBe(generator.generate(request, { ...baseVersions, promptVersion: "2.0" }))
    })
  })

  describe("#given different schema_version", () => {
    it("#when generate #then returns different key", () => {
      const generator = createCacheKeyGenerator()
      const request = { problem_statement: "problem", options: ["A", "B"] }
      const baseVersions = {
        modelId: "m",
        promptVersion: "1.0",
        mode: "permissive" as const,
      }

      expect(
        generator.generate(request, { ...baseVersions, schemaVersion: 1 }),
      ).not.toBe(generator.generate(request, { ...baseVersions, schemaVersion: 2 }))
    })
  })

  describe("#given different mode (permissive vs strict)", () => {
    it("#when generate #then returns different key", () => {
      const generator = createCacheKeyGenerator()
      const request = { problem_statement: "problem", options: ["A", "B"] }
      const baseVersions = {
        modelId: "m",
        promptVersion: "1.0",
        schemaVersion: 1,
      }

      expect(
        generator.generate(request, { ...baseVersions, mode: "permissive" }),
      ).not.toBe(generator.generate(request, { ...baseVersions, mode: "strict" }))
    })
  })

  describe("#given same request with different key ordering in JSON", () => {
    it("#when generate #then returns identical key (normalization works)", () => {
      const generator = createCacheKeyGenerator()
      const versions = {
        modelId: "m",
        promptVersion: "1.0",
        schemaVersion: 1,
        mode: "permissive" as const,
      }
      const firstRequest = {
        problem_statement: "problem",
        options: ["A", "B"],
        context: { alpha: 1, beta: 2 },
      }
      const secondRequest = {
        options: ["A", "B"],
        context: { beta: 2, alpha: 1 },
        problem_statement: "problem",
      }

      expect(generator.generate(firstRequest, versions)).toBe(
        generator.generate(secondRequest, versions),
      )
    })
  })

  describe("#given 1000 randomly generated requests", () => {
    it("#when generate #then no collisions among them", () => {
      const generator = createCacheKeyGenerator()
      const versions = {
        modelId: "m",
        promptVersion: "1.0",
        schemaVersion: 1,
        mode: "permissive" as const,
      }
      const keys = new Set<string>()

      for (let i = 0; i < 1000; i++) {
        const request = {
          problem_statement: `problem ${i}`,
          options: [`A${i}`, `B${i}`],
        }

        keys.add(generator.generate(request, versions))
      }

      expect(keys.size).toBe(1000)
    })
  })
})
