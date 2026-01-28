import { describe, expect, test } from "bun:test"
import {
  checkDefinitionOfReady,
  checkDefinitionOfDone,
  type TaskContext,
  type ReadinessResult,
  type CompletenessResult,
} from "./index"

describe("definition-gates", () => {
  describe("checkDefinitionOfReady", () => {
    test("passes when all criteria met", () => {
      //#given
      const context: TaskContext = {
        goal: "Add login button to header",
        filesIdentified: ["/src/components/Header.tsx"],
        testCriteria: "Button visible and clickable",
        dependenciesMapped: true,
        hasAmbiguity: false,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(true)
      expect(result.missingCriteria).toHaveLength(0)
    })

    test("fails when goal is missing", () => {
      //#given
      const context: TaskContext = {
        goal: "",
        filesIdentified: ["/src/components/Header.tsx"],
        testCriteria: "Button visible",
        dependenciesMapped: true,
        hasAmbiguity: false,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(false)
      expect(result.missingCriteria).toContain("goal_is_atomic")
    })

    test("fails when files not identified", () => {
      //#given
      const context: TaskContext = {
        goal: "Add login button",
        filesIdentified: [],
        testCriteria: "Button visible",
        dependenciesMapped: true,
        hasAmbiguity: false,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(false)
      expect(result.missingCriteria).toContain("files_identified")
    })

    test("fails when test criteria missing", () => {
      //#given
      const context: TaskContext = {
        goal: "Add login button",
        filesIdentified: ["/src/Header.tsx"],
        testCriteria: "",
        dependenciesMapped: true,
        hasAmbiguity: false,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(false)
      expect(result.missingCriteria).toContain("test_criteria_defined")
    })

    test("fails when ambiguity exists", () => {
      //#given
      const context: TaskContext = {
        goal: "Add login button",
        filesIdentified: ["/src/Header.tsx"],
        testCriteria: "Button works",
        dependenciesMapped: true,
        hasAmbiguity: true,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(false)
      expect(result.missingCriteria).toContain("no_ambiguity")
    })

    test("reports multiple missing criteria", () => {
      //#given
      const context: TaskContext = {
        goal: "",
        filesIdentified: [],
        testCriteria: "",
        dependenciesMapped: false,
        hasAmbiguity: true,
      }

      //#when
      const result = checkDefinitionOfReady(context)

      //#then
      expect(result.ready).toBe(false)
      expect(result.missingCriteria.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe("checkDefinitionOfDone", () => {
    test("passes when all criteria met", () => {
      //#given
      const context = {
        testsPass: true,
        typesPass: true,
        noForbiddenPatterns: true,
        followsCodebaseStyle: true,
        todoMarkedComplete: true,
      }

      //#when
      const result = checkDefinitionOfDone(context)

      //#then
      expect(result.complete).toBe(true)
      expect(result.failedCriteria).toHaveLength(0)
    })

    test("fails when tests fail", () => {
      //#given
      const context = {
        testsPass: false,
        typesPass: true,
        noForbiddenPatterns: true,
        followsCodebaseStyle: true,
        todoMarkedComplete: true,
      }

      //#when
      const result = checkDefinitionOfDone(context)

      //#then
      expect(result.complete).toBe(false)
      expect(result.failedCriteria).toContain("tests_pass")
    })

    test("fails when types fail", () => {
      //#given
      const context = {
        testsPass: true,
        typesPass: false,
        noForbiddenPatterns: true,
        followsCodebaseStyle: true,
        todoMarkedComplete: true,
      }

      //#when
      const result = checkDefinitionOfDone(context)

      //#then
      expect(result.complete).toBe(false)
      expect(result.failedCriteria).toContain("types_pass")
    })

    test("fails when forbidden patterns found", () => {
      //#given
      const context = {
        testsPass: true,
        typesPass: true,
        noForbiddenPatterns: false,
        followsCodebaseStyle: true,
        todoMarkedComplete: true,
      }

      //#when
      const result = checkDefinitionOfDone(context)

      //#then
      expect(result.complete).toBe(false)
      expect(result.failedCriteria).toContain("no_forbidden_patterns")
    })

    test("reports multiple failed criteria", () => {
      //#given
      const context = {
        testsPass: false,
        typesPass: false,
        noForbiddenPatterns: false,
        followsCodebaseStyle: false,
        todoMarkedComplete: false,
      }

      //#when
      const result = checkDefinitionOfDone(context)

      //#then
      expect(result.complete).toBe(false)
      expect(result.failedCriteria.length).toBe(5)
    })
  })
})
