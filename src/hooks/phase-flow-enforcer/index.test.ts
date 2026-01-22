import { describe, it, expect } from "bun:test"
import { HOOK_NAME, PHASE_ORDER, VALID_TRANSITIONS, PHASE_SKIP_WARNING } from "./constants"

describe("phase-flow-enforcer constants", () => {
  // #given constants are exported
  // #when accessing constant values
  // #then they should have expected values

  it("should export correct hook name", () => {
    expect(HOOK_NAME).toBe("phase-flow-enforcer")
  })

  it("should define all phases in correct order", () => {
    expect(PHASE_ORDER).toEqual([
      "idle",
      "planning",
      "reviewing",
      "executing",
      "awaiting_user",
      "completed",
      "failed",
    ])
  })

  it("should define valid transitions for all phases", () => {
    // Every phase in PHASE_ORDER should have transitions defined
    for (const phase of PHASE_ORDER) {
      expect(VALID_TRANSITIONS[phase]).toBeDefined()
      expect(Array.isArray(VALID_TRANSITIONS[phase])).toBe(true)
      expect(VALID_TRANSITIONS[phase].length).toBeGreaterThan(0)
    }
  })

  it("should allow idle to transition to planning", () => {
    expect(VALID_TRANSITIONS.idle).toContain("planning")
  })

  it("should allow planning to transition to reviewing", () => {
    expect(VALID_TRANSITIONS.planning).toContain("reviewing")
  })

  it("should allow reviewing to go back to planning (rejection)", () => {
    expect(VALID_TRANSITIONS.reviewing).toContain("planning")
  })

  it("should allow executing to transition to awaiting_user", () => {
    expect(VALID_TRANSITIONS.executing).toContain("awaiting_user")
  })

  it("should allow executing to transition to failed", () => {
    expect(VALID_TRANSITIONS.executing).toContain("failed")
  })

  it("should allow completed to restart (transition to idle)", () => {
    expect(VALID_TRANSITIONS.completed).toContain("idle")
  })

  it("should allow failed to restart", () => {
    expect(VALID_TRANSITIONS.failed).toContain("idle")
    expect(VALID_TRANSITIONS.failed).toContain("planning")
  })
})

describe("phase-flow-enforcer warning", () => {
  // #given an invalid phase transition
  // #when generating warning message
  // #then it should include helpful information

  it("should generate warning with current and attempted phases", () => {
    const warning = PHASE_SKIP_WARNING("idle", "executing")
    
    expect(warning).toContain("Phase Flow Violation")
    expect(warning).toContain("idle")
    expect(warning).toContain("executing")
  })

  it("should include valid transitions in warning", () => {
    const warning = PHASE_SKIP_WARNING("idle", "completed")
    
    expect(warning).toContain("Valid transitions from idle")
    expect(warning).toContain("planning")
  })

  it("should include required phase flow diagram", () => {
    const warning = PHASE_SKIP_WARNING("planning", "completed")
    
    expect(warning).toContain("idle → planning → reviewing → executing")
  })
})

describe("phase-flow-enforcer hook behavior", () => {
  // #given a mock plugin context
  // #when boulder.json is modified with phase change
  // #then it should validate the transition

  it("should create hook without errors", async () => {
    const { createPhaseFlowEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createPhaseFlowEnforcerHook(mockCtx)
    
    expect(hook).toBeDefined()
    expect(hook["tool.execute.after"]).toBeDefined()
  })

  it("should ignore non-Write/Edit tools", async () => {
    const { createPhaseFlowEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createPhaseFlowEnforcerHook(mockCtx)
    
    const output = { result: '{"phase": "completed"}', output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test", tool: "Read", args: { filePath: "/test/.sisyphus/boulder.json" } },
      output
    )
    
    // Should not inject warning for Read tool
    expect(output.output).toBe("")
  })

  it("should ignore writes to non-boulder files", async () => {
    const { createPhaseFlowEnforcerHook } = await import("./index")
    
    const mockCtx = { directory: "/test" } as any
    const hook = createPhaseFlowEnforcerHook(mockCtx)
    
    const output = { result: '{"phase": "completed"}', output: "" }
    await hook["tool.execute.after"](
      { sessionID: "test", tool: "Write", args: { filePath: "/test/other.json" } },
      output
    )
    
    expect(output.output).toBe("")
  })
})
