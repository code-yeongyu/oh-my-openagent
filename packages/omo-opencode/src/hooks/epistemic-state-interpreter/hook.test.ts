import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as loggerModule from "../../shared/logger"
import { createEpistemicStateInterpreterHook } from "./hook"
import { storeVerdict, _resetForTesting as resetVerdictStore } from "./verdict-store"
import { _resetForTesting as resetAnnotationStore, getAnnotations } from "./annotation-store"
import type { PolicyVerdict } from "../reasoning-core-policy-gate/types"

const VALID_PROOF_ARTIFACT = {
  theory: {},
  result: {
    semantics: "preferred",
    extensions: [
      {
        index: 0,
        accepted_conclusions: ["-promote(marco)", "promote(luca)"],
      },
    ],
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
      "promote(luca)": {
        conclusion: "promote(luca)",
        status: "Accepted",
        proof_chain: [
          {
            conclusion: "promote(luca)",
            from: ["consistent_performance(luca)"],
            rule_id: "d4",
            rule_kind: "defeasible",
          },
        ],
      },
    },
  },
}

const ALLOW_VERDICT_WITH_ARTIFACT: PolicyVerdict = {
  allow: true,
  proofArtifact: VALID_PROOF_ARTIFACT,
}

const ALLOW_VERDICT_NO_ARTIFACT: PolicyVerdict = {
  allow: true,
}

const DENY_VERDICT: PolicyVerdict = {
  allow: false,
  reason: "denied",
  proofArtifact: VALID_PROOF_ARTIFACT,
}

const ENABLED_CONFIG = { epistemic_state_interpreter_enabled: true }
const DISABLED_CONFIG = { epistemic_state_interpreter_enabled: false }

afterEach(() => {
  resetVerdictStore()
  resetAnnotationStore()
})

describe("createEpistemicStateInterpreterHook", () => {
  describe("#given config disabled", () => {
    it("#when invoked #then returns immediately without side effects", async () => {
      const hook = createEpistemicStateInterpreterHook(DISABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
      expect(getAnnotations("s1")).toHaveLength(0)
    })
  })

  describe("#given no verdict in store", () => {
    it("#when invoked #then returns without annotations", async () => {
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
      expect(getAnnotations("s1")).toHaveLength(0)
    })

    it("#when invoked #then logs quietly without writing to stderr", async () => {
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()

      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] no verdict found"),
        expect.objectContaining({ sessionID: "s1", tool: "bash", callID: "c1" }),
      )

      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given verdict with valid proofArtifact", () => {
    it("#when invoked #then stores annotations for each conclusion", async () => {
      storeVerdict("s1:c1", ALLOW_VERDICT_WITH_ARTIFACT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)

      const annotations = getAnnotations("s1")
      expect(annotations.length).toBeGreaterThan(0)

      const neg = annotations.find((a) => a.conclusion === "-promote(marco)")
      expect(neg).toBeDefined()
      expect(neg?.state).toBe("accepted")
      expect(neg?.proofChainKind).toBe("strict")

      const luca = annotations.find((a) => a.conclusion === "promote(luca)")
      expect(luca).toBeDefined()
      expect(luca?.state).toBe("plausible")
      expect(luca?.proofChainKind).toBe("defeasible")
    })

    it("#when invoked #then emits diagnostics through logger and not stderr", async () => {
      storeVerdict("s1:c1", ALLOW_VERDICT_WITH_ARTIFACT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      await hook["tool.execute.before"](input, output)

      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] annotation updated"),
        expect.objectContaining({ sessionID: "s1", conclusion: "-promote(marco)" }),
      )

      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })

    it("#when verdict is deny with artifact #then still annotates", async () => {
      storeVerdict("s1:c1", DENY_VERDICT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)
      expect(getAnnotations("s1").length).toBeGreaterThan(0)
    })
  })

  describe("#given verdict with no proofArtifact", () => {
    it("#when invoked #then returns without annotations", async () => {
      storeVerdict("s1:c1", ALLOW_VERDICT_NO_ARTIFACT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)
      expect(getAnnotations("s1")).toHaveLength(0)
    })
  })

  describe("#given any error during processing", () => {
    it("#when internal error occurs #then NEVER throws", async () => {
      storeVerdict("s1:c1", ALLOW_VERDICT_WITH_ARTIFACT)
      const hook = createEpistemicStateInterpreterHook(ENABLED_CONFIG)
      const input = { tool: "bash", sessionID: "s1", callID: "c1" }
      const output = { args: {} }

      // Force an error by temporarily breaking classifyEpistemicState
      const classifierModule = await import("./classifier")
      const spy = spyOn(classifierModule, "classifyEpistemicState").mockImplementation(() => {
        throw new Error("simulated classifier error")
      })

      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()

      spy.mockRestore()
    })
  })
})
