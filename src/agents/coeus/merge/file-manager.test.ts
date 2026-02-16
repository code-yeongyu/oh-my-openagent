/// <reference types="bun-types" />

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createSubPlanDir, writeSubPlan, readSubPlans, cleanupSubPlans } from "./file-manager"
import type { SubPlan } from "../schemas/sub-plan-schema"

const tempDir = "/tmp/test-sub-plans"

beforeEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true })
  }
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true })
  }
})

describe("Sub-Plan File Manager", () => {
  describe("createSubPlanDir", () => {
    test("creates directory at correct path", () => {
      // #given
      const projectDir = tempDir
      const sessionId = "ses-123"

      // #when
      const result = createSubPlanDir(projectDir, sessionId)

      // #then
      expect(result).toBe(join(projectDir, ".sisyphus/sub-plans/ses-123"))
      expect(existsSync(result)).toBe(true)
    })

    test("creates nested directories if they don't exist", () => {
      // #given
      const projectDir = join(tempDir, "nested/project")
      const sessionId = "ses-456"

      // #when
      const result = createSubPlanDir(projectDir, sessionId)

      // #then
      expect(existsSync(result)).toBe(true)
      expect(result).toContain("ses-456")
    })
  })

  describe("writeSubPlan", () => {
    test("writes valid JSON matching SubPlanSchema", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-write-test")
      const domain = "auth"
      const content = JSON.stringify({
        domain: "auth",
        domain_description: "Authentication module",
        tasks: [
          {
            id: "t1",
            title: "Implement login",
            description: "Add login endpoint",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/auth.ts"],
            acceptance_criteria: ["Login works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test-planner",
      })

      // #when
      const result = writeSubPlan(dir, domain, content)

      // #then
      expect(result).toBe(join(dir, "auth.json"))
      expect(existsSync(result)).toBe(true)
      const written = readFileSync(result, "utf-8")
      expect(JSON.parse(written)).toEqual(JSON.parse(content))
    })

    test("overwrites existing sub-plan", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-overwrite-test")
      const domain = "api"
      const content1 = JSON.stringify({
        domain: "api",
        domain_description: "API v1",
        tasks: [
          {
            id: "t1",
            title: "Create endpoint",
            description: "POST /api/users",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Endpoint works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      })
      const content2 = JSON.stringify({
        domain: "api",
        domain_description: "API v2",
        tasks: [
          {
            id: "t2",
            title: "Update endpoint",
            description: "PUT /api/users",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/api.ts"],
            acceptance_criteria: ["Update works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      })

      // #when
      writeSubPlan(dir, domain, content1)
      const result = writeSubPlan(dir, domain, content2)

      // #then
      const written = readFileSync(result, "utf-8")
      expect(JSON.parse(written).domain_description).toBe("API v2")
    })
  })

  describe("readSubPlans", () => {
    test("reads and parses all sub-plans from directory", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-read-test")
      const subPlan1 = {
        domain: "auth",
        domain_description: "Auth module",
        tasks: [
          {
            id: "t1",
            title: "Login",
            description: "Login endpoint",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/auth.ts"],
            acceptance_criteria: ["Works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      }
      const subPlan2 = {
        domain: "db",
        domain_description: "Database module",
        tasks: [
          {
            id: "t2",
            title: "Schema",
            description: "Create schema",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/db.ts"],
            acceptance_criteria: ["Schema created"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      }

      // #when
      writeSubPlan(dir, "auth", JSON.stringify(subPlan1))
      writeSubPlan(dir, "db", JSON.stringify(subPlan2))
      const result = readSubPlans(dir)

      // #then
      expect(result).toHaveLength(2)
      expect(result.map((p) => p.domain).sort()).toEqual(["auth", "db"])
      expect(result.find((p) => p.domain === "auth")?.domain_description).toBe("Auth module")
    })

    test("skips invalid JSON files with warning", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-invalid-test")
      const validPlan = {
        domain: "valid",
        domain_description: "Valid plan",
        tasks: [
          {
            id: "t1",
            title: "Task",
            description: "Desc",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/file.ts"],
            acceptance_criteria: ["Works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      }

      // #when
      writeSubPlan(dir, "valid", JSON.stringify(validPlan))
      // Write invalid JSON directly
      const fs = require("node:fs")
      fs.writeFileSync(join(dir, "invalid.json"), "{ invalid json }")

      // Capture console.warn
      let warnCalled = false
      const originalWarn = console.warn
      console.warn = () => {
        warnCalled = true
      }

      const result = readSubPlans(dir)

      console.warn = originalWarn

      // #then
      expect(result).toHaveLength(1)
      expect(result[0].domain).toBe("valid")
      expect(warnCalled).toBe(true)
    })

    test("returns empty array for empty directory", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-empty-test")

      // #when
      const result = readSubPlans(dir)

      // #then
      expect(result).toEqual([])
    })

    test("skips non-JSON files", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-non-json-test")
      const validPlan = {
        domain: "valid",
        domain_description: "Valid",
        tasks: [
          {
            id: "t1",
            title: "Task",
            description: "Desc",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/file.ts"],
            acceptance_criteria: ["Works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      }

      // #when
      writeSubPlan(dir, "valid", JSON.stringify(validPlan))
      const fs = require("node:fs")
      fs.writeFileSync(join(dir, "readme.md"), "# README")
      fs.writeFileSync(join(dir, "data.txt"), "some data")

      const result = readSubPlans(dir)

      // #then
      expect(result).toHaveLength(1)
      expect(result[0].domain).toBe("valid")
    })
  })

  describe("cleanupSubPlans", () => {
    test("removes directory and all contents", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-cleanup-test")
      const subPlan = {
        domain: "test",
        domain_description: "Test",
        tasks: [
          {
            id: "t1",
            title: "Task",
            description: "Desc",
            depends_on: [],
            category: "quick",
            skills: [],
            files_touched: ["src/file.ts"],
            acceptance_criteria: ["Works"],
          },
        ],
        wave_assignments: { wave1: 1 },
        constraints_acknowledged: true,
        source_sub_planner: "test",
      }
      writeSubPlan(dir, "test", JSON.stringify(subPlan))
      expect(existsSync(dir)).toBe(true)

      // #when
      cleanupSubPlans(dir)

      // #then
      expect(existsSync(dir)).toBe(false)
    })

    test("handles cleanup of non-existent directory gracefully", () => {
      // #given
      const dir = join(tempDir, "non-existent")

      // #when & #then
      expect(() => cleanupSubPlans(dir)).not.toThrow()
    })
  })

  describe("Round-trip: Write and Read", () => {
    test("round-trip preserves all data", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-roundtrip-test")
      const originalPlan: SubPlan = {
        domain: "payment",
        domain_description: "Payment processing system",
        tasks: [
          {
            id: "t1",
            title: "Stripe integration",
            description: "Integrate Stripe API",
            depends_on: [],
            category: "deep",
            skills: ["api-integration"],
            files_touched: ["src/payment/stripe.ts", "src/payment/types.ts"],
            acceptance_criteria: ["Stripe API integrated", "Tests pass"],
            must_not_do: ["Don't hardcode API keys"],
            qa_scenarios: ["Test payment flow"],
          },
        ],
        wave_assignments: { wave1: 1, wave2: 0 },
        constraints_acknowledged: true,
        source_sub_planner: "prometheus-v1",
      }

      // #when
      writeSubPlan(dir, originalPlan.domain, JSON.stringify(originalPlan))
      const readPlans = readSubPlans(dir)

      // #then
      expect(readPlans).toHaveLength(1)
      const readPlan = readPlans[0]
      expect(readPlan.domain).toBe(originalPlan.domain)
      expect(readPlan.domain_description).toBe(originalPlan.domain_description)
      expect(readPlan.tasks).toEqual(originalPlan.tasks)
      expect(readPlan.wave_assignments).toEqual(originalPlan.wave_assignments)
      expect(readPlan.constraints_acknowledged).toBe(originalPlan.constraints_acknowledged)
      expect(readPlan.source_sub_planner).toBe(originalPlan.source_sub_planner)
    })
  })

  describe("Cleanup removes all temp files", () => {
    test("cleanup removes directory with 3 sub-plans", () => {
      // #given
      const dir = createSubPlanDir(tempDir, "ses-multi-cleanup-test")
      const plans = ["auth", "db", "api"]
      plans.forEach((domain) => {
        const plan = {
          domain,
          domain_description: `${domain} module`,
          tasks: [
            {
              id: "t1",
              title: "Task",
              description: "Desc",
              depends_on: [],
              category: "quick",
              skills: [],
              files_touched: ["src/file.ts"],
              acceptance_criteria: ["Works"],
            },
          ],
          wave_assignments: { wave1: 1 },
          constraints_acknowledged: true,
          source_sub_planner: "test",
        }
        writeSubPlan(dir, domain, JSON.stringify(plan))
      })
      expect(readdirSync(dir)).toHaveLength(3)

      // #when
      cleanupSubPlans(dir)

      // #then
      expect(existsSync(dir)).toBe(false)
    })
  })
})
