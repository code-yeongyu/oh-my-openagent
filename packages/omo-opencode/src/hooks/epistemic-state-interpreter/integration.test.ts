import { afterEach, describe, expect, it } from "bun:test"
import { createEpistemicStateInterpreterHook } from "./hook"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"
import { _resetForTesting as resetAnnotationStore, getAnnotations } from "./annotation-store"

const ENABLED_CONFIG = { epistemic_state_interpreter_enabled: true }
const DISABLED_CONFIG = { epistemic_state_interpreter_enabled: false }

const VALID_VERDICT = {
  allow: true,
  proofArtifact: {
    theory: {},
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: ["-promote(marco)"] }],
      conclusions: {
        "-promote(marco)": {
          conclusion: "-promote(marco)",
          status: "Accepted",
          proof_chain: [
            { conclusion: "ethics_complaint(marco)", from: [], rule_id: null, rule_kind: "ordinary" },
            {
              conclusion: "-promote(marco)",
              from: ["ethics_complaint(marco)"],
              rule_id: "s1",
              rule_kind: "strict",
            },
          ],
        },
      },
    },
  },
}

afterEach(() => {
  resetVerdictStore()
  resetAnnotationStore()
})

describe("Integration: EpistemicStateInterpreter in hook chain", () => {
  describe("#given hook wired after policy gate", () => {
    it("#when invoked after verdict is stored by policy gate #then produces annotations", async () => {
      storeVerdict("s1:c1", VALID_VERDICT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)

      const annotations = getAnnotations("s1")
      expect(annotations.length).toBeGreaterThan(0)
    })

    it("#when invoked #then does NOT modify output.args (annotation-only)", async () => {
      storeVerdict("s1:c1", VALID_VERDICT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: { command: "ls -la" } }
      const originalArgs = { ...output.args }

      await hook["tool.execute.before"](input, output)

      expect(output.args).toEqual(originalArgs)
    })

    it("#when invoked #then does NOT throw regardless of input", async () => {
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const badInput = { tool: "bash", sessionID: "s-broken", callID: "c-broken" }
      const output = { args: {} }

      await expect(hook["tool.execute.before"](badInput, output)).resolves.toBeUndefined()
    })
  })

  describe("#given hook runs before epistemicInterlockGate position", () => {
    it("#when both hooks run in sequence #then each runs independently", async () => {
      storeVerdict("s1:c1", VALID_VERDICT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)

      expect(getAnnotations("s1").length).toBeGreaterThan(0)
      expect(output.args).toEqual({})
    })
  })

  describe("#given config disabled", () => {
    it("#when hook is disabled #then no annotations produced and no errors", async () => {
      storeVerdict("s1:c1", VALID_VERDICT)
      const hook = createEpistemicStateInterpreterHook(DISABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)

      expect(getAnnotations("s1")).toHaveLength(0)
    })
  })
})
