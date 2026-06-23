import { describe, test, expect, afterEach } from "bun:test"
import type { SolverName } from "./chain"
import { SOLVER_PREFERENCE } from "./chain"
import { ChallengeKindSchema, type ChallengeKind } from "../types"
import { createSolverRegistry } from "./solvers"

describe("captcha chain types", () => {
  test("#given solver names #when listed #then includes all 7 with anti-captcha added", () => {
    const solvers: SolverName[] = [
      "skip", "playwright-captcha", "whisper-audio", "vision-llm", "manual", "capsolver", "anti-captcha",
    ]
    expect(solvers).toHaveLength(7)
  })
})

describe("SOLVER_PREFERENCE", () => {
  test("#given every kind in ChallengeKindSchema #when SOLVER_PREFERENCE checked #then has at least one preference entry", () => {
    for (const kind of ChallengeKindSchema.options) {
      expect(SOLVER_PREFERENCE[kind].length).toBeGreaterThan(0)
    }
  })

  test("#given hCaptcha kinds #when SOLVER_PREFERENCE checked #then anti-captcha is first", () => {
    expect(SOLVER_PREFERENCE.hcaptcha_checkbox[0]).toBe("anti-captcha")
    expect(SOLVER_PREFERENCE.hcaptcha_image_grid[0]).toBe("anti-captcha")
    expect(SOLVER_PREFERENCE.hcaptcha_turbo[0]).toBe("anti-captcha")
    expect(SOLVER_PREFERENCE.hcaptcha_enterprise[0]).toBe("anti-captcha")
  })

  test("#given hCaptcha kinds #when SOLVER_PREFERENCE checked #then capsolver removed (CapSolver dropped hCaptcha)", () => {
    expect(SOLVER_PREFERENCE.hcaptcha_checkbox).not.toContain("capsolver")
    expect(SOLVER_PREFERENCE.hcaptcha_image_grid).not.toContain("capsolver")
    expect(SOLVER_PREFERENCE.hcaptcha_turbo).not.toContain("capsolver")
    expect(SOLVER_PREFERENCE.hcaptcha_enterprise).not.toContain("capsolver")
  })

  test("#given arkose_funcaptcha #when SOLVER_PREFERENCE checked #then anti-captcha is first (CapSolver dropped FunCaptcha)", () => {
    expect(SOLVER_PREFERENCE.arkose_funcaptcha[0]).toBe("anti-captcha")
    expect(SOLVER_PREFERENCE.arkose_funcaptcha).not.toContain("capsolver")
  })

  test("#given recaptcha v2 kinds #when SOLVER_PREFERENCE checked #then capsolver first then anti-captcha", () => {
    expect(SOLVER_PREFERENCE.recaptcha_v2_checkbox[0]).toBe("capsolver")
    expect(SOLVER_PREFERENCE.recaptcha_v2_checkbox).toContain("anti-captcha")
    expect(SOLVER_PREFERENCE.recaptcha_v2_image[0]).toBe("capsolver")
    expect(SOLVER_PREFERENCE.recaptcha_v2_image).toContain("anti-captcha")
  })

  test("#given cloudflare_turnstile #when SOLVER_PREFERENCE checked #then capsolver first with anti-captcha included", () => {
    expect(SOLVER_PREFERENCE.cloudflare_turnstile[0]).toBe("capsolver")
    expect(SOLVER_PREFERENCE.cloudflare_turnstile).toContain("anti-captcha")
  })

  test("#given geetest kinds #when SOLVER_PREFERENCE checked #then capsolver first then anti-captcha", () => {
    expect(SOLVER_PREFERENCE.geetest_v3[0]).toBe("capsolver")
    expect(SOLVER_PREFERENCE.geetest_v3).toContain("anti-captcha")
    expect(SOLVER_PREFERENCE.geetest_v4[0]).toBe("capsolver")
    expect(SOLVER_PREFERENCE.geetest_v4).toContain("anti-captcha")
  })

  test("#given anti-captcha-only kinds (datadome, mtcaptcha, aws_waf) #when SOLVER_PREFERENCE checked #then anti-captcha not present", () => {
    expect(SOLVER_PREFERENCE.datadome).not.toContain("anti-captcha")
    expect(SOLVER_PREFERENCE.mtcaptcha).not.toContain("anti-captcha")
    expect(SOLVER_PREFERENCE.aws_waf).not.toContain("anti-captcha")
  })
})

describe("manual solver gating", () => {
  const originalFlag = process.env.IDM_CAPTCHA_MANUAL_FALLBACK
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.IDM_CAPTCHA_MANUAL_FALLBACK
    } else {
      process.env.IDM_CAPTCHA_MANUAL_FALLBACK = originalFlag
    }
  })

  test("#given env flag unset #when manual solver invoked #then returns false fast (no 30s wait)", async () => {
    delete process.env.IDM_CAPTCHA_MANUAL_FALLBACK
    const registry = createSolverRegistry()
    const manual = registry.get("manual")
    expect(manual).toBeDefined()
    const start = Date.now()
    const result = await manual!(undefined as never, { kind: "hcaptcha_image_grid", confidence: 0.9 })
    const elapsed = Date.now() - start
    expect(result).toBe(false)
    expect(elapsed).toBeLessThan(1_000)
  })
})

describe("anti-captcha solver registration", () => {
  test("#given createSolverRegistry called without anti-captcha apiKey #when registry queried #then anti-captcha returns false", async () => {
    const registry = createSolverRegistry({})
    const fn = registry.get("anti-captcha")
    expect(fn).toBeDefined()
    const result = await fn!(undefined as never, { kind: "hcaptcha_checkbox" as ChallengeKind, confidence: 0.9 })
    expect(result).toBe(false)
  })
})
