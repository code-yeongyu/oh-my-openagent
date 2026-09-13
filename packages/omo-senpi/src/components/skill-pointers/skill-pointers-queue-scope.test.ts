/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { ULW_LOOP_CUSTOM_TYPE } from "./index"
import { dispatchInput, expectPointerInjections, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers queued prompts and session scope", () => {
  describe("#given a queued prompt", () => {
    it("#when streamingBehavior is set #then all pointers ride inside the same message", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw loop queued work", "interactive", "steer")

      // then
      expect(result.action).toBe("transform")
      if (result.action !== "transform") throw new Error("expected transform")
      expect(result.text).toMatch(/^mass ulw loop queued work\n/)
      expect(result.text).toContain("mass-ulw/SKILL.md")
      expect(result.text).toContain("ulw-loop/SKILL.md")
      expect(pi.messages).toHaveLength(0)
    })
  })

  describe("#given ulw-loop session scope", () => {
    it("#when the input session id is known #then the pointer carries its normalized scope", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      const result = await dispatchInput(pi, "run ulw-loop", "interactive", undefined, {
        sessionManager: { getSessionId: () => "session/a weird" },
      })

      expectPointerInjections(pi, result, [{ customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" }])
      const content = pi.messages[0]?.message["content"]
      expect(content).toContain("tool.omo_agent_toolkit")
      expect(content).toContain(".omo/ulw-loop/session-a-weird/")
    })

    it("#when a queued RPC input changes sessions #then the pointer uses that event's scope", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)
      await dispatchInput(pi, "run ulw-loop", "interactive", undefined, {
        sessionManager: { getSessionId: () => "previous-session" },
      })

      const prompt = "/skill:mass-ulw then ulw-loop"
      const result = await dispatchInput(pi, prompt, "rpc", "steer", {
        sessionManager: { getSessionId: () => "new/session" },
      })

      expect(result.action).toBe("transform")
      if (result.action !== "transform") throw new Error("expected transform")
      expect(result.text).toStartWith(`${prompt}\n<omo-ulw-loop-pointer>`)
      expect(result.text).toContain(".omo/ulw-loop/new-session/")
      expect(result.text).not.toContain(".omo/ulw-loop/previous-session/")
      expect(pi.messages).toHaveLength(1)
    })

    it("#when the input session id is unknown #then the pointer omits the session flag", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      const result = await dispatchInput(pi, "run ulw-loop")

      expectPointerInjections(pi, result, [{ customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" }])
      const content = pi.messages[0]?.message["content"]
      expect(content).not.toContain("--session-id")
      expect(content).not.toContain(".omo/ulw-loop/")
    })
  })
})
