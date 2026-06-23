import { describe, expect, it, mock } from "bun:test"
import { FormalizationError } from "./errors"
import { createFormalizationQualityChecker } from "./formalization-quality-checker"
import { createSemanticFormalizationService, type ServiceDeps } from "./service"
import type { FormalizationRequest, Theory } from "./types"

const request = {
  problem_statement: "pick option a or b",
  options: ["option_a", "option_b"],
  constraints: [],
  preferences: [],
  requested_semantics: "preferred",
} satisfies FormalizationRequest

const makeMinimalTheory = (): Theory => ({
  premises: [
    { formula: "problem(current)", kind: "ordinary" },
    { formula: "support(option_a) @option:option_a", kind: "ordinary" },
  ],
  defeasible_rules: [
    { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a"], consequent: "select_option_a" },
  ],
  classical_negation: true,
})

function createCacheStore(): ServiceDeps["cacheStore"] {
  const cache = new Map<string, Parameters<ServiceDeps["cacheStore"]["set"]>[1]>()

  return {
    get: mock((key: string) => cache.get(key)),
    set: mock((key: string, value: Parameters<ServiceDeps["cacheStore"]["set"]>[1]) => {
      cache.set(key, value)
    }),
    has: mock((key: string) => cache.has(key)),
  }
}

const makeDeps = (overrides: Partial<ServiceDeps> = {}): ServiceDeps => ({
  llmCaller: { call: mock(async () => ({ status: "ok" as const, theory: makeMinimalTheory() })) },
  schemaParser: { parse: mock(() => makeMinimalTheory()) },
  theoryValidator: { validate: mock((theory: Theory) => theory) },
  qualityChecker: createFormalizationQualityChecker(),
  cacheKeyGen: { generate: mock(() => "key-123") },
  cacheStore: createCacheStore(),
  logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}) },
  modelId: "test-model",
  promptVersion: "1.0.0",
  schemaVersion: 1,
  ...overrides,
})

async function expectFormalizationError(
  action: Promise<unknown>,
  expectedCode: FormalizationError["code"],
) {
  try {
    await action
    throw new Error("Expected formalize to throw")
  } catch (error) {
    expect(error instanceof FormalizationError).toBe(true)
    if (!(error instanceof FormalizationError)) {
      return
    }

    expect(error.code).toBe(expectedCode)
  }
}

describe("createSemanticFormalizationService", () => {
  describe("#given cache miss", () => {
    describe("#when formalize", () => {
      it("#then calls LLM, parses, validates, stores in cache, returns theory with provenance cacheHit false", async () => {
        const theory = makeMinimalTheory()
        const deps = makeDeps({
          schemaParser: { parse: mock(() => theory) },
          theoryValidator: { validate: mock(() => theory) },
        })
        const service = createSemanticFormalizationService(deps)

        const result = await service.formalize(request, { expectedOptionAtoms: ["select_option_a"] })

        expect(deps.llmCaller.call).toHaveBeenCalledTimes(1)
        expect(deps.schemaParser.parse).toHaveBeenCalledTimes(1)
        expect(deps.theoryValidator.validate).toHaveBeenCalledWith(theory, ["select_option_a"])
        expect(deps.cacheStore.set).toHaveBeenCalledTimes(1)
        expect(result.theory).toBe(theory)
        expect(result.provenance.cache_hit).toBe(false)
        expect(result.provenance.iterations_attempted).toBe(1)
      })
    })
  })

  describe("#given cache hit (same request called twice)", () => {
    describe("#when formalize second call", () => {
      it("#then returns cached theory cacheHit true, zero LLM calls", async () => {
        const theory = makeMinimalTheory()
        const deps = makeDeps({
          schemaParser: { parse: mock(() => theory) },
          theoryValidator: { validate: mock(() => theory) },
        })
        const service = createSemanticFormalizationService(deps)

        await service.formalize(request)
        const result = await service.formalize(request)

        expect(result.theory).toBe(theory)
        expect(result.provenance.cache_hit).toBe(true)
        expect(deps.llmCaller.call).toHaveBeenCalledTimes(1)
        expect(deps.schemaParser.parse).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe("#given LLM throws FormalizationError provider_failure", () => {
    describe("#when formalize", () => {
      it("#then surfaces error without fallback", async () => {
        const deps = makeDeps({
          llmCaller: {
            call: mock(async () => Promise.reject(new FormalizationError({ code: "provider_failure" }))),
          },
        })
        const service = createSemanticFormalizationService(deps)

        await expectFormalizationError(service.formalize(request), "provider_failure")
        expect(deps.schemaParser.parse).toHaveBeenCalledTimes(0)
      })
    })
  })

  describe("#given schema parser throws FormalizationError schema_invalid", () => {
    describe("#when formalize", () => {
      it("#then surfaces schema_invalid error", async () => {
        const deps = makeDeps({
          schemaParser: {
            parse: mock(() => {
              throw new FormalizationError({ code: "schema_invalid" })
            }),
          },
        })
        const service = createSemanticFormalizationService(deps)

        await expectFormalizationError(service.formalize(request), "schema_invalid")
        expect(deps.theoryValidator.validate).toHaveBeenCalledTimes(0)
      })
    })
  })

  describe("#given llm caller returns explicit formalizer error envelope", () => {
    describe("#when formalize", () => {
      it("#then surfaces a typed formalization error without parsing theory", async () => {
        const deps = makeDeps({
          llmCaller: {
            call: mock(async () => ({ status: "error" as const, error_code: "missing_theory" as const, message: "missing_theory", recoverable: true })),
          },
        })
        const service = createSemanticFormalizationService(deps)

        await expectFormalizationError(service.formalize(request), "missing_theory")
        expect(deps.schemaParser.parse).toHaveBeenCalledTimes(0)
      })
    })
  })

  describe("#given theory validator throws FormalizationError theory_invalid", () => {
    describe("#when formalize", () => {
      it("#then surfaces theory_invalid error", async () => {
        const deps = makeDeps({
          theoryValidator: {
            validate: mock(() => {
              throw new FormalizationError({ code: "theory_invalid" })
            }),
          },
        })
        const service = createSemanticFormalizationService(deps)

        await expectFormalizationError(service.formalize(request), "theory_invalid")
      })
    })
  })

  describe("#given mode strict and isInteractive false", () => {
    describe("#when formalize", () => {
      it("#then throws FormalizationError code confirmation_required before calling LLM", async () => {
        const deps = makeDeps()
        const service = createSemanticFormalizationService(deps)

        await expectFormalizationError(
          service.formalize(request, { mode: "strict", isInteractive: false }),
          "confirmation_required",
        )
        expect(deps.llmCaller.call).toHaveBeenCalledTimes(0)
      })
    })
  })

  describe("#given first theory fails quality checks and second theory passes", () => {
    describe("#when formalize", () => {
      it("#then retries once and returns the second validated theory", async () => {
        let calls = 0
        const lowQualityTheory: Theory = {
          premises: [{ formula: "problem(current)", kind: "ordinary" }],
          defeasible_rules: [
            { id: "d-a", antecedents: ["problem(current)"], consequent: "select_option_a" },
            { id: "d-b", antecedents: ["problem(current)"], consequent: "select_option_b" },
          ],
          classical_negation: true,
        }
        const highQualityTheory: Theory = {
          premises: [
            { formula: "problem(current)", kind: "ordinary" },
            { formula: "support(option_a) @option:option_a @value:safety", kind: "ordinary" },
            { formula: "harm(option_a) @option:option_a @valence:harm:severe @value:dignity", kind: "ordinary" },
            { formula: "support(option_b) @option:option_b @value:autonomy", kind: "ordinary" },
          ],
          defeasible_rules: [
            { id: "d-a", antecedents: ["problem(current)", "support(option_a) @option:option_a @value:safety"], consequent: "select_option_a" },
            { id: "d-b", antecedents: ["problem(current)", "support(option_b) @option:option_b @value:autonomy"], consequent: "select_option_b" },
          ],
          classical_negation: true,
        }
        const deps = makeDeps({
          llmCaller: {
            call: mock(async () => {
              calls += 1
              return { status: "ok" as const, theory: calls === 1 ? lowQualityTheory : highQualityTheory }
            }),
          },
          schemaParser: { parse: mock((theory: Theory) => theory) },
          theoryValidator: { validate: mock((theory: Theory) => theory) },
        })
        const service = createSemanticFormalizationService(deps)

        const result = await service.formalize(request, { expectedOptionAtoms: ["select_option_a", "select_option_b"] })

        expect(calls).toBe(2)
        expect(result.theory).toBe(highQualityTheory)
        expect(result.provenance.iterations_attempted).toBe(2)
      })
    })
  })
})
