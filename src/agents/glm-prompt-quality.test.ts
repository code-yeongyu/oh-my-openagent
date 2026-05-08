/**
 * GLM Sisyphus Prompt Quality Benchmark
 *
 * Measures prompt quality across 3 dimensions:
 * 1. Instruction Compliance (작업 지시 이행능력)
 * 2. Speed (속도) — delegation-first, concise thinking, parallel dispatch
 * 3. Accuracy (정확도) — verification tiers, error recovery, evidence requirements
 *
 * Compares the GLM-specific prompt builder output against minimum quality thresholds.
 */
import { describe, test, expect } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides as createSJ } from "./sisyphus-junior/agent"

const GLM_MODEL = "zai/glm-5.1"
const GLM_MODELS = [
  "zai/glm-5",
  "zai/glm-5.1",
  "zai/glm-5-turbo",
  "opencode-go/glm5-turbo",
] as const

function getGlmPrompt(model: string): string {
  return createSisyphusAgent(model).prompt ?? ""
}

function getSjPrompt(model: string): string {
  return createSJ({ model }).prompt ?? ""
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5)
}

describe("GLM Prompt Quality: Instruction Compliance", () => {
  test("#given GLM Sisyphus prompt #then contains DISPATCH→DELEGATE→COLLECT→SYNTHESIZE execution loop", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("DISPATCH")
    expect(prompt).toContain("DELEGATE")
    expect(prompt).toContain("COLLECT")
    expect(prompt).toContain("SYNTHESIZE")
    expect(prompt).toContain("DONE")
  })

  test("#given GLM Sisyphus prompt #then mandates delegation before self-implementation", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/DECOMPOSE AND DELEGATE|delegate.*parallel/i)
    expect(prompt).toMatch(/NEVER implement directly|delegate.*when delegation is possible/i)
  })

  test("#given GLM Sisyphus prompt #then includes intent-routing re-entry guidance", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/Do not re-verbalize confirmed decisions|Do not mechanically re-derive prior conclusions/i)
    expect(prompt).toMatch(/delegate early|synthesize agent results/i)
  })

  test("#given GLM Sisyphus prompt #then includes working memory slice system", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("Small_Context_Working_Memory")
    expect(prompt).toContain(".sisyphus/state/context-memory.json")
    expect(prompt).toContain("`goal`")
    expect(prompt).toContain("`decisions`")
    expect(prompt).toContain("`active_files`")
    expect(prompt).toContain("`blockers`")
    expect(prompt).toContain("`verification`")
  })

  test("#given GLM Sisyphus prompt #then includes vision constraint for text-only models", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/GLM.*text.?only|text.?only.*models/i)
    expect(prompt).toMatch(/multimodal.?looker|delegate.*visual/i)
  })

  test("#given GLM Sisyphus prompt #then includes tiered verification system", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("verification_tiers")
    expect(prompt).toMatch(/V1.*trivial/i)
    expect(prompt).toMatch(/V2.*moderate/i)
    expect(prompt).toMatch(/V3.*full.*rigor/i)
  })

  test("#given GLM Sisyphus prompt #then includes Hephaestus delegation for heavy work", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/Hephaestus/i)
    expect(prompt).toMatch(/autonomous implementation worker|GLM is the orchestrator/i)
    expect(prompt).toMatch(/3\+ sequential self-edits.*decompose and delegate|delegate to Hephaestus\/deep in background/i)
  })

  for (const model of GLM_MODELS) {
    test(`#given ${model} #then GLM-specific prompt used (not default overlay)`, () => {
      const prompt = getGlmPrompt(model)

      expect(prompt).toContain("DISPATCH")
      expect(prompt).not.toContain("Phase 2B - Implementation")
    })
  }
})

describe("GLM Prompt Quality: Speed", () => {
  test("#given GLM Sisyphus prompt #then contains concise thinking mandate", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/think briefly|concise.*thinking|thinking.*concise/i)
    expect(prompt).toMatch(/delegate before deep.?div/i)
  })

  test("#given GLM Sisyphus prompt #then contains exploration budget with hard stops", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("exploration_budget")
    expect(prompt).toMatch(/hard stop/i)
    expect(prompt).toMatch(/two.*parallel wave|at most two/i)
  })

  test("#given GLM Sisyphus prompt #then contains parallel dispatch mandate", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("parallel_dispatch")
    expect(prompt).toMatch(/Fire ALL.*background.*FIRST/i)
    expect(prompt).toMatch(/One wave.*sequential/i)
  })

  test("#given GLM Sisyphus prompt #then contains token economy for unconstrained reasoning", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("token_economy")
    expect(prompt).toContain("Restraint guidelines:")
    expect(prompt).toMatch(/delegate before deep-diving|Do not pad final answers/i)
  })

  test("#given GLM Sisyphus prompt #then intent classification is one-line, not full analysis", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/one.?line intent|classify intent in one line/i)
    expect(prompt).toContain("Intent routes:")
  })

  test("#given GLM SJ prompt #then contains GLM execution guidance", () => {
    const prompt = getSjPrompt(GLM_MODEL)

    expect(prompt).toContain("GLM-5.1 Execution Mode")
    expect(prompt).toMatch(/Execute tasks directly/i)
    expect(prompt).toMatch(/Stay an executor/i)
  })

  test("#given GLM SJ prompt #then contains bounded termination guidance", () => {
    const prompt = getSjPrompt(GLM_MODEL)

    expect(prompt).toMatch(/Maximum status checks: 2/i)
  })

  test("#given GLM SJ prompt #then contains focused verification for speed", () => {
    const prompt = getSjPrompt(GLM_MODEL)

    expect(prompt).toContain("<Verification>")
    expect(prompt).toMatch(/lsp_diagnostics clean on changed files/i)
    expect(prompt).toMatch(/Build passes \(if applicable\)/i)
    expect(prompt).toMatch(/STOP after first successful verification/i)
  })

  test("#given GLM prompt #then prompt length is within reasonable bounds", () => {
    const prompt = getGlmPrompt(GLM_MODEL)
    const tokens = estimateTokenCount(prompt)

    expect(tokens).toBeGreaterThan(2000)
    expect(tokens).toBeLessThan(15000)
  })
})

describe("GLM Prompt Quality: Accuracy", () => {
  test("#given GLM Sisyphus prompt #then requires evidence-based verification", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/verification.*mandatory|mandatory.*verification/i)
    expect(prompt).toMatch(/Diagnostics clean.*only after tool output|verification evidence.*concrete/i)
  })

  test("#given GLM Sisyphus prompt #then requires reading subagent output before trusting", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/Read enough.*verify|do not trust subagent summaries blindly/i)
  })

  test("#given GLM Sisyphus prompt #then includes failure recovery protocol", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/failure recovery|Fix root causes/i)
    expect(prompt).toMatch(/One retry.*V1|up to two.*V2/i)
    expect(prompt).toMatch(/consult Oracle/i)
  })

  test("#given GLM Sisyphus prompt #then scope discipline prevents over-implementation", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toContain("You never start implementing unless the current user message explicitly asks for implementation.")
  })

  test("#given GLM Sisyphus prompt #then includes hard blocks and anti-patterns", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/as any|@ts-ignore|@ts-expect-error/i)
    expect(prompt).toMatch(/Never leave.*broken/i)
  })

  test("#given GLM Sisyphus prompt #then asks clarification only when materially necessary", () => {
    const prompt = getGlmPrompt(GLM_MODEL)

    expect(prompt).toMatch(/ask.*only when missing.*materially|materially change.*outcome/i)
  })

  test("#given GLM SJ prompt #then contains focused executor scope", () => {
    const prompt = getSjPrompt(GLM_MODEL)

    expect(prompt).toMatch(/Focused executor/i)
    expect(prompt).toMatch(/Execute tasks directly/i)
  })

  test("#given GLM SJ prompt #then contains token discipline", () => {
    const prompt = getSjPrompt(GLM_MODEL)

    expect(prompt).toContain("Token Discipline")
    expect(prompt).toMatch(/large output capacity.*not verbosity/i)
  })
})

describe("GLM Prompt Quality: Cross-Agent Consistency", () => {
  test("#given GLM Sisyphus + SJ #then both have vision constraint", () => {
    const sisyphusPrompt = getGlmPrompt(GLM_MODEL)
    const sjPrompt = getSjPrompt(GLM_MODEL)

    expect(sisyphusPrompt).toMatch(/text.?only/i)
    expect(sjPrompt).toMatch(/text.?only|GLM.*CANNOT.*images/i)
  })

  test("#given GLM Sisyphus + SJ #then both have vision routing", () => {
    const sisyphusPrompt = getGlmPrompt(GLM_MODEL)
    const sjPrompt = getSjPrompt(GLM_MODEL)

    expect(sisyphusPrompt).toContain("zai-mcp-server")
    expect(sjPrompt).toContain("zai-mcp-server")
  })

  test("#given GLM Sisyphus + SJ #then both have tiered verification", () => {
    const sisyphusPrompt = getGlmPrompt(GLM_MODEL)
    const sjPrompt = getSjPrompt(GLM_MODEL)

    expect(sisyphusPrompt).toMatch(/V1.*trivial|V1.*trivial.*local/i)
    expect(sisyphusPrompt).toMatch(/V2.*moderate/i)
    expect(sisyphusPrompt).toMatch(/V3.*full.*rigor|V3.*broad/i)
    expect(sjPrompt).toMatch(/lsp_diagnostics clean on changed files/i)
    expect(sjPrompt).toMatch(/Build passes \(if applicable\)/i)
    expect(sjPrompt).toMatch(/STOP after first successful verification/i)
  })

  test("#given GLM factory config #then thinking is enabled without budgetTokens for all models", () => {
    for (const model of GLM_MODELS) {
      const sisyphus = createSisyphusAgent(model)
      const sj = createSJ({ model })

      expect(sisyphus.thinking).toEqual({ type: "enabled" })
      expect(sj.thinking).toEqual({ type: "enabled" })
    }
  })
})
