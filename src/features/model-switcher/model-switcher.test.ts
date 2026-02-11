import { describe, expect, test } from "bun:test"
import type { AgentOverrides } from "../../agents/types"

import {
  getCurrentModelInfo,
  getCandidates,
  getActiveModel,
  setActiveModel,
  loadCandidates,
} from "./index"

describe("ModelSwitcher", () => {
  describe("Initial state", () => {
    test("should load candidates into state", () => {
      const agentOverrides: AgentOverrides = {}
      loadCandidates(agentOverrides)

      expect(getCandidates("test_agent_1")).toEqual([])
      expect(getCandidates("test_agent_2")).toEqual([])
    })

    test("should parse model_candidates from config", () => {
      const agentOverrides: AgentOverrides = {
        test_agent_3: {
          model: "default-model",
          model_candidates: ["model1", "model2", "model3"],
        },
        test_agent_4: {
          model_candidates: ["modelA", "modelB"],
        },
      }

      loadCandidates(agentOverrides)

      expect(getCandidates("test_agent_3")).toEqual(["model1", "model2", "model3"])
      expect(getCandidates("test_agent_4")).toEqual(["modelA", "modelB"])
      expect(getCandidates("oracle")).toEqual([])
    })

    test("should handle empty model_candidates array", () => {
      const agentOverrides: AgentOverrides = {
        test_agent_5: {
          model: "default-model",
          model_candidates: [],
        },
      }

      loadCandidates(agentOverrides)

      expect(getCandidates("test_agent_5")).toEqual([])
    })
  })

  describe("Model overrides", () => {
    test("should set active model override", () => {
      loadCandidates({
        test_agent_6: {
          model: "default-model",
          model_candidates: ["model1", "model2", "model3"],
        },
      })

      setActiveModel("test_agent_6", "model2")

      const activeModel = getActiveModel("test_agent_6")
      expect(activeModel).toBe("model2")
    })

    test("should return overridden model", () => {
      setActiveModel("test_agent_7", "model1")

      const activeModel = getActiveModel("test_agent_7")

      expect(activeModel).toBe("model1")
    })
  })

  describe("Candidate retrieval", () => {
    test("should return candidates array for agent with candidates", () => {
      const candidates = getCandidates("test_agent_3")

      expect(candidates).toEqual(["model1", "model2", "model3"])
    })

    test("should return empty array for agent without candidates", () => {
      const candidates = getCandidates("test_agent_8")

      expect(candidates).toEqual([])
    })
  })

  describe("Multiple model switches", () => {
    test("should update active model each time", () => {
      loadCandidates({
        test_agent_9: {
          model: "default-model",
          model_candidates: ["model1", "model2", "model3"],
        },
      })

      setActiveModel("test_agent_9", "model1")
      expect(getActiveModel("test_agent_9")).toBe("model1")

      setActiveModel("test_agent_9", "model2")
      expect(getActiveModel("test_agent_9")).toBe("model2")

      setActiveModel("test_agent_9", "model3")
      expect(getActiveModel("test_agent_9")).toBe("model3")
    })
  })

  describe("Current model info", () => {
    test("should return comprehensive state snapshot", () => {
      loadCandidates({
        test_agent_10: {
          model: "default-model",
          model_candidates: ["model1", "model2", "model3"],
        },
        test_agent_11: {
          model_candidates: ["modelA", "modelB"],
        },
      })

      setActiveModel("test_agent_10", "model2")

      const info = getCurrentModelInfo()

      expect(info).toMatchObject({
        test_agent_10: {
          active: "model2",
          candidates: ["model1", "model2", "model3"],
        },
        test_agent_11: {
          active: undefined,
          candidates: ["modelA", "modelB"],
        },
      })
    })
  })

  describe("Invalid agent name handling", () => {
    test("should return empty array for non-existent agent", () => {
      const candidates = getCandidates("non-existent-agent")

      expect(candidates).toEqual([])
    })

    test("should return undefined for non-existent agent", () => {
      const activeModel = getActiveModel("non-existent-agent")

      expect(activeModel).toBeUndefined()
    })
  })

  describe("Backward compatibility", () => {
    test("should handle config without model_candidates field", () => {
      const agentOverrides: AgentOverrides = {
        test_agent_12: {
          model: "default-model",
        },
      }

      loadCandidates(agentOverrides)

      expect(getCandidates("test_agent_12")).toEqual([])
      expect(getActiveModel("test_agent_12")).toBeUndefined()
    })
  })
})
