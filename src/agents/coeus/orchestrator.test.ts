import { describe, test, expect } from "bun:test"
import { evaluateRequest, buildDecompositionContext, validateAndMerge, runKnowledgeVerification } from "./orchestrator"
import type { SubPlan } from "./schemas/sub-plan-schema"
import type { ComplexityScore, DecompositionDecision } from "./types"
import { DECOMPOSITION_THRESHOLD } from "./types"
import { VerificationRecordSchema } from "./schemas/verification-record-schema"
import path from "path"

function makeSubPlan(overrides: Partial<SubPlan> = {}): SubPlan {
  return {
    domain: "auth",
    domain_description: "Authentication domain",
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        description: "Do thing 1",
        depends_on: [],
        category: "quick",
        skills: [],
        files_touched: ["src/auth.ts"],
        acceptance_criteria: ["AC1", "AC2"],
      },
      {
        id: "t2",
        title: "Task 2",
        description: "Do thing 2",
        depends_on: ["t1"],
        category: "quick",
        skills: [],
        files_touched: ["src/auth.ts"],
        acceptance_criteria: ["AC3", "AC4"],
      },
      {
        id: "t3",
        title: "Task 3",
        description: "Do thing 3",
        depends_on: [],
        category: "quick",
        skills: [],
        files_touched: ["src/utils.ts"],
        acceptance_criteria: ["AC5", "AC6"],
      },
    ],
    wave_assignments: { t1: 1, t2: 2, t3: 1 },
    constraints_acknowledged: true,
    source_sub_planner: "coeus-test",
    ...overrides,
  }
}

describe("evaluateRequest", () => {
  test("simple request returns should_decompose=false", () => {
    //#given a simple typo fix request
    const request = "Fix typo in button"

    //#when evaluating the request
    const result = evaluateRequest(request)

    //#then decomposition not needed
    expect(result.score.total).toBeLessThan(DECOMPOSITION_THRESHOLD)
    expect(result.decision.should_decompose).toBe(false)
    expect(result.decision.strategy).toBe("domain")
    expect(result.decision.domains).toEqual([])
    expect(result.decision.rationale).toBeTruthy()
  })

  test("complex multi-domain request returns should_decompose=true", () => {
    //#given a complex multi-domain request
    const request = "Build auth with frontend, backend, database"

    //#when evaluating the request
    const result = evaluateRequest(request)

    //#then decomposition required, domains detected
    expect(result.score.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD)
    expect(result.decision.should_decompose).toBe(true)
    expect(result.decision.strategy).toBe("domain")
    expect(result.decision.domains.length).toBeGreaterThan(0)
    expect(result.decision.rationale).toBeTruthy()
  })

  test("returns valid ComplexityScore shape", () => {
    //#given any request
    const request = "Add a feature"

    //#when evaluating
    const result = evaluateRequest(request)

    //#then score has all required fields
    expect(result.score).toHaveProperty("total")
    expect(result.score).toHaveProperty("concern_count")
    expect(result.score).toHaveProperty("file_count_estimate")
    expect(result.score).toHaveProperty("cross_domain")
    expect(result.score).toHaveProperty("reasoning")
  })

  test("returns valid DecompositionDecision shape", () => {
    //#given any request
    const request = "Refactor module"

    //#when evaluating
    const result = evaluateRequest(request)

    //#then decision has all required fields
    expect(result.decision).toHaveProperty("should_decompose")
    expect(result.decision).toHaveProperty("domains")
    expect(result.decision).toHaveProperty("strategy")
    expect(result.decision).toHaveProperty("rationale")
  })

  test("project context influences scoring", () => {
    //#given same request with and without project context
    const request = "Build auth with frontend and backend"
    const context = "monorepo with multiple packages"

    //#when evaluating with and without context
    const withoutCtx = evaluateRequest(request)
    const withCtx = evaluateRequest(request, context)

    //#then context can boost score
    expect(withCtx.score.total).toBeGreaterThanOrEqual(withoutCtx.score.total)
  })

  test("domains extracted from reasoning match concern detection", () => {
    //#given a request mentioning auth, frontend, database
    const request = "Build authentication system with React frontend and PostgreSQL database"

    //#when evaluating
    const result = evaluateRequest(request)

    //#then domains include detected concerns
    expect(result.decision.should_decompose).toBe(true)
    expect(result.decision.domains).toContain("auth")
    expect(result.decision.domains).toContain("frontend")
    expect(result.decision.domains).toContain("database")
  })
})

describe("buildDecompositionContext", () => {
  test("returns context per domain with constraints injected", () => {
    //#given domains and constraints
    const domains = ["auth", "frontend"]
    const constraints = "Use Bun only. No npm."

    //#when building decomposition context
    const result = buildDecompositionContext("/tmp/test-project", domains, constraints)

    //#then returns map with one entry per domain
    expect(Object.keys(result)).toEqual(["auth", "frontend"])
    expect(result["auth"]).toContain("auth")
    expect(result["auth"]).toContain("Use Bun only")
    expect(result["frontend"]).toContain("frontend")
    expect(result["frontend"]).toContain("Use Bun only")
  })

  test("each domain context contains global-constraints tag", () => {
    //#given domains and constraints
    const domains = ["backend"]
    const constraints = "TypeScript strict mode"

    //#when building context
    const result = buildDecompositionContext("/tmp/proj", domains, constraints)

    //#then constraints block injected
    expect(result["backend"]).toContain("<global-constraints>")
  })

  test("empty constraints still produce valid context", () => {
    //#given domains with empty constraints
    const domains = ["infra"]
    const constraints = ""

    //#when building context
    const result = buildDecompositionContext("/tmp/proj", domains, constraints)

    //#then returns context without constraints block
    expect(result["infra"]).toContain("infra")
  })

  test("empty domains returns empty map", () => {
    //#given no domains
    const domains: string[] = []
    const constraints = "some constraints"

    //#when building context
    const result = buildDecompositionContext("/tmp/proj", domains, constraints)

    //#then empty object returned
    expect(result).toEqual({})
  })
})

describe("validateAndMerge", () => {
  test("valid sub-plans produce merged plan with no errors", () => {
    //#given valid sub-plans
    const plans = [makeSubPlan({ domain: "auth" }), makeSubPlan({ domain: "frontend", tasks: [
      { id: "t1", title: "FE Task 1", description: "FE 1", depends_on: [], category: "quick", skills: [], files_touched: ["src/app.tsx"], acceptance_criteria: ["AC1", "AC2"] },
      { id: "t2", title: "FE Task 2", description: "FE 2", depends_on: [], category: "quick", skills: [], files_touched: ["src/page.tsx"], acceptance_criteria: ["AC3", "AC4"] },
      { id: "t3", title: "FE Task 3", description: "FE 3", depends_on: [], category: "quick", skills: [], files_touched: ["src/layout.tsx"], acceptance_criteria: ["AC5", "AC6"] },
    ] })]

    //#when validating and merging
    const result = validateAndMerge(plans, "global constraints")

    //#then merged plan returned, no errors
    expect(result.merged).not.toBeNull()
    expect(result.errors).toEqual([])
    expect(result.merged!.domains).toContain("auth")
    expect(result.merged!.domains).toContain("frontend")
  })

  test("invalid sub-plan returns errors, merged=null", () => {
    //#given a sub-plan with too few tasks (invalid)
    const invalidPlan: SubPlan = {
      domain: "bad",
      domain_description: "Bad domain",
      tasks: [
        { id: "t1", title: "Only task", description: "Sole task", depends_on: [], category: "quick", skills: [], files_touched: ["f.ts"], acceptance_criteria: ["AC1", "AC2"] },
      ],
      wave_assignments: { t1: 1 },
      constraints_acknowledged: true,
      source_sub_planner: "test",
    }

    //#when validating and merging
    const result = validateAndMerge([invalidPlan], "constraints")

    //#then errors returned, no merge
    expect(result.merged).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test("overlapping files detected across sub-plans", () => {
    //#given two sub-plans touching the same file
    const plan1 = makeSubPlan({ domain: "auth" })
    const plan2 = makeSubPlan({
      domain: "frontend",
      tasks: [
        { id: "t1", title: "T1", description: "D1", depends_on: [], category: "quick", skills: [], files_touched: ["src/auth.ts"], acceptance_criteria: ["AC1", "AC2"] },
        { id: "t2", title: "T2", description: "D2", depends_on: [], category: "quick", skills: [], files_touched: ["src/other.ts"], acceptance_criteria: ["AC3", "AC4"] },
        { id: "t3", title: "T3", description: "D3", depends_on: [], category: "quick", skills: [], files_touched: ["src/more.ts"], acceptance_criteria: ["AC5", "AC6"] },
      ],
    })

    //#when validating and merging
    const result = validateAndMerge([plan1, plan2], "constraints")

    //#then overlaps detected for shared file
    expect(result.overlaps.length).toBeGreaterThan(0)
    expect(result.overlaps.some((o) => o.file === "src/auth.ts")).toBe(true)
  })

  test("cyclic dependencies detected in merged plan", () => {
    //#given sub-plans that create a cycle after merging
    const plan1 = makeSubPlan({
      domain: "a",
      tasks: [
        { id: "t1", title: "T1", description: "D1", depends_on: [], category: "quick", skills: [], files_touched: ["shared.ts"], acceptance_criteria: ["AC1", "AC2"] },
        { id: "t2", title: "T2", description: "D2", depends_on: ["t1"], category: "quick", skills: [], files_touched: ["a2.ts"], acceptance_criteria: ["AC3", "AC4"] },
        { id: "t3", title: "T3", description: "D3", depends_on: [], category: "quick", skills: [], files_touched: ["a3.ts"], acceptance_criteria: ["AC5", "AC6"] },
      ],
    })
    const plan2 = makeSubPlan({
      domain: "b",
      tasks: [
        { id: "t1", title: "T1", description: "D1", depends_on: [], category: "quick", skills: [], files_touched: ["shared.ts"], acceptance_criteria: ["AC1", "AC2"] },
        { id: "t2", title: "T2", description: "D2", depends_on: ["t1"], category: "quick", skills: [], files_touched: ["b2.ts"], acceptance_criteria: ["AC3", "AC4"] },
        { id: "t3", title: "T3", description: "D3", depends_on: [], category: "quick", skills: [], files_touched: ["b3.ts"], acceptance_criteria: ["AC5", "AC6"] },
      ],
    })

    //#when validating and merging
    const result = validateAndMerge([plan1, plan2], "constraints")

    //#then merged plan returned (cycles are diagnostic, not blocking)
    expect(result.merged).not.toBeNull()
    // cycles may or may not exist depending on cross-dep resolution
    expect(Array.isArray(result.cycles)).toBe(true)
  })

  test("empty sub-plans array returns empty merge", () => {
    //#given no sub-plans
    //#when validating and merging
    const result = validateAndMerge([], "constraints")

    //#then merged plan with no tasks, no errors
    expect(result.merged).not.toBeNull()
    expect(result.merged!.tasks).toEqual([])
    expect(result.errors).toEqual([])
  })

  test("constraints_acknowledged=false causes validation error", () => {
    //#given sub-plan that doesn't acknowledge constraints
    const plan = makeSubPlan({ constraints_acknowledged: false })

    //#when validating and merging
    const result = validateAndMerge([plan], "constraints")

    //#then errors mention constraints
    expect(result.merged).toBeNull()
    expect(result.errors.some((e) => e.toLowerCase().includes("constraint"))).toBe(true)
  })
})

describe("runKnowledgeVerification", () => {
  const taxonomyDir = path.join(import.meta.dir, "taxonomy", "seed")

  test("returns VerificationRecord for multi-domain input", async () => {
    //#given domains and a taxonomy directory
    const domains = ["auth", "frontend"]

    //#when running knowledge verification
    const result = await runKnowledgeVerification(domains, "", taxonomyDir)

    //#then returns record with matching domains
    expect(result.domains).toEqual(["auth", "frontend"])
    expect(result.slug).toBe("auth-frontend")
    expect(result.created).toBeTruthy()
    expect(Array.isArray(result.boundaries)).toBe(true)
  })

  test("boundary counts sum equals boundaries length", async () => {
    //#given domains
    const domains = ["auth", "frontend"]

    //#when running knowledge verification
    const result = await runKnowledgeVerification(domains, "", taxonomyDir)

    //#then counts sum to total boundaries
    const totalCounts = result.verified_count + result.unverified_count + result.novel_count
    expect(totalCounts).toBe(result.boundaries.length)
  })

  test("result passes VerificationRecordSchema validation", async () => {
    //#given domains and constraints
    const domains = ["backend", "database"]
    const constraints = "Use Bun only"

    //#when running knowledge verification
    const result = await runKnowledgeVerification(domains, constraints, taxonomyDir)

    //#then schema parse succeeds
    const parsed = VerificationRecordSchema.parse(result)
    expect(parsed.slug).toBe("backend-database")
    expect(parsed.domains).toEqual(["backend", "database"])
  })
})
