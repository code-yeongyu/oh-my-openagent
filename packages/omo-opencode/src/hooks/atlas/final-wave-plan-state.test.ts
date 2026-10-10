import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFinalWavePlanState } from "./final-wave-plan-state"

describe("readFinalWavePlanState", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "final-wave-plan-state-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function writePlan(content: string): string {
    const planPath = join(directory, "plan.md")
    writeFileSync(planPath, content)
    return planPath
  }

  test("#given T, F, and H task rows #when read #then pending rows are counted with the progress counter's grammar", () => {
    // given
    const planPath = writePlan([
      "## TODOs",
      "- [x] T1.1 Build",
      "- [ ] T6.3a Remaining implementation",
      "## Final Verification Wave",
      "- [ ] F1 \u2014 Plan compliance audit",
      "- [ ] H1 \u2014 User approval",
    ].join("\n"))

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state).toEqual({ pendingImplementationTaskCount: 1, pendingFinalWaveTaskCount: 2 })
  })

  test("#given canonical N. and F<n>. rows #when read #then the counts are unchanged", () => {
    // given
    const planPath = writePlan([
      "## TODOs",
      "- [x] 1. Ship the implementation",
      "- [ ] 2. Follow-up",
      "## Final Verification Wave (MANDATORY - after ALL implementation tasks)",
      "- [x] F1. **Plan Compliance Audit**",
      "- [ ] F2. **Code Quality Review**",
    ].join("\n"))

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state).toEqual({ pendingImplementationTaskCount: 1, pendingFinalWaveTaskCount: 1 })
  })

  test("#given blocked and completed final-wave rows #when read #then neither is pending", () => {
    // given
    const planPath = writePlan([
      "## TODOs",
      "- [x] T1.1 Build",
      "## Final Verification Wave",
      "- [~] F1 \u2014 Plan compliance audit",
      "- [x] H1 \u2014 User approval",
    ].join("\n"))

    // when
    const state = readFinalWavePlanState(planPath)

    // then
    expect(state).toEqual({ pendingImplementationTaskCount: 0, pendingFinalWaveTaskCount: 0 })
  })
})
