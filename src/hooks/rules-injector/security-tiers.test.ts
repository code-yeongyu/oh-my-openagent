/**
 * Security Tiers Tests
 */

import { describe, test, expect } from "bun:test"
import {
  classifySecurityTier,
  getSecurityAnalysisPrompt,
  DEFAULT_SECURITY_TIER_CONFIG,
} from "./security-tiers"

describe("Security Tiers", () => {
  describe("classifySecurityTier", () => {
    test("should classify read operations as LOW", () => {
      // #given - a read operation
      const tool = "read"
      const args = { filePath: "src/config.ts" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be LOW
      expect(tier).toBe("LOW")
    })

    test("should classify glob operations as LOW", () => {
      // #given - a glob operation
      const tool = "glob"
      const args = { pattern: "**/*.ts" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be LOW
      expect(tier).toBe("LOW")
    })

    test("should classify write operations as MEDIUM", () => {
      // #given - a write operation
      const tool = "write"
      const args = { filePath: "src/config.ts", content: "test" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be MEDIUM
      expect(tier).toBe("MEDIUM")
    })

    test("should classify edit operations as MEDIUM", () => {
      // #given - an edit operation
      const tool = "edit"
      const args = { filePath: "src/config.ts" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be MEDIUM
      expect(tier).toBe("MEDIUM")
    })

    test("should classify rm -rf as HIGH", () => {
      // #given - a bash command with rm -rf
      const tool = "bash"
      const args = { command: "rm -rf /tmp/test" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify rm -r as HIGH", () => {
      // #given - a bash command with rm -r
      const tool = "bash"
      const args = { command: "rm -r ./build" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify git push --force as HIGH", () => {
      // #given - a bash command with force push
      const tool = "bash"
      const args = { command: "git push origin main --force" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify git reset --hard as HIGH", () => {
      // #given - a bash command with hard reset
      const tool = "bash"
      const args = { command: "git reset --hard HEAD~1" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify DROP TABLE as HIGH", () => {
      // #given - a bash command with SQL DROP
      const tool = "bash"
      const args = { command: "psql -c 'DROP TABLE users'" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify docker rm -f as HIGH", () => {
      // #given - a bash command with docker rm -f
      const tool = "bash"
      const args = { command: "docker rm -f container_name" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify kubectl delete as HIGH", () => {
      // #given - a bash command with kubectl delete
      const tool = "bash"
      const args = { command: "kubectl delete pod my-pod" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should classify git commit as MEDIUM", () => {
      // #given - a bash command with git commit
      const tool = "bash"
      const args = { command: "git commit -m 'fix: update'" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be MEDIUM
      expect(tier).toBe("MEDIUM")
    })

    test("should classify npm install as MEDIUM", () => {
      // #given - a bash command with npm install
      const tool = "bash"
      const args = { command: "npm install lodash" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be MEDIUM
      expect(tier).toBe("MEDIUM")
    })

    test("should classify simple bash commands as LOW", () => {
      // #given - a simple bash command
      const tool = "bash"
      const args = { command: "ls -la" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be LOW
      expect(tier).toBe("LOW")
    })

    test("should classify echo commands as LOW", () => {
      // #given - an echo command
      const tool = "bash"
      const args = { command: "echo 'hello world'" }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args)

      // #then - should be LOW
      expect(tier).toBe("LOW")
    })

    test("should respect custom HIGH tier patterns", () => {
      // #given - custom config with additional HIGH pattern
      const tool = "bash"
      const args = { command: "my-dangerous-command --destroy" }
      const config = {
        ...DEFAULT_SECURITY_TIER_CONFIG,
        high_tier_patterns: ["my-dangerous-command"],
      }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args, config)

      // #then - should be HIGH
      expect(tier).toBe("HIGH")
    })

    test("should respect custom MEDIUM tier patterns", () => {
      // #given - custom config with additional MEDIUM pattern
      const tool = "bash"
      const args = { command: "my-modify-command --update" }
      const config = {
        ...DEFAULT_SECURITY_TIER_CONFIG,
        medium_tier_patterns: ["my-modify-command"],
      }

      // #when - classifying security tier
      const tier = classifySecurityTier(tool, args, config)

      // #then - should be MEDIUM
      expect(tier).toBe("MEDIUM")
    })
  })

  describe("getSecurityAnalysisPrompt", () => {
    test("should return prompt for HIGH tier", () => {
      // #given - a HIGH tier operation
      const tool = "bash"
      const tier = "HIGH" as const
      const command = "rm -rf /tmp/test"

      // #when - getting security prompt
      const prompt = getSecurityAnalysisPrompt(tool, tier, command)

      // #then - should return analysis prompt
      expect(prompt).not.toBeNull()
      expect(prompt).toContain("Security Analysis Required")
      expect(prompt).toContain("HIGH RISK")
      expect(prompt).toContain("Impact Assessment")
      expect(prompt).toContain("Reversibility")
    })

    test("should return null for LOW tier", () => {
      // #given - a LOW tier operation
      const tool = "read"
      const tier = "LOW" as const

      // #when - getting security prompt
      const prompt = getSecurityAnalysisPrompt(tool, tier)

      // #then - should return null
      expect(prompt).toBeNull()
    })

    test("should return null for MEDIUM tier", () => {
      // #given - a MEDIUM tier operation
      const tool = "write"
      const tier = "MEDIUM" as const

      // #when - getting security prompt
      const prompt = getSecurityAnalysisPrompt(tool, tier)

      // #then - should return null
      expect(prompt).toBeNull()
    })

    test("should include command preview in prompt", () => {
      // #given - a HIGH tier operation with command
      const tool = "bash"
      const tier = "HIGH" as const
      const command = "git push --force origin main"

      // #when - getting security prompt
      const prompt = getSecurityAnalysisPrompt(tool, tier, command)

      // #then - should include command
      expect(prompt).toContain(command)
    })

    test("should truncate long commands in prompt", () => {
      // #given - a HIGH tier operation with very long command
      const tool = "bash"
      const tier = "HIGH" as const
      const command = "a".repeat(200)

      // #when - getting security prompt
      const prompt = getSecurityAnalysisPrompt(tool, tier, command)

      // #then - should truncate and add ellipsis
      expect(prompt).toContain("...")
      expect(prompt!.length).toBeLessThan(command.length + 500)
    })
  })
})
