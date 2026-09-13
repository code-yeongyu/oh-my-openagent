/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { MASS_ULW_CUSTOM_TYPE, ULTIMATE_BROWSING_CUSTOM_TYPE, ULW_LOOP_CUSTOM_TYPE, ULW_RESEARCH_CUSTOM_TYPE } from "./index"
import { dispatchInput, expectNoInjection, expectPointerInjections, injectedContent, registerSkillPointers } from "./test-support"

const RESEARCH = { customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research" } as const
const COMPANION = { customType: ULTIMATE_BROWSING_CUSTOM_TYPE, skillName: "ultimate-browsing" } as const

describe("omo-senpi skill-pointers companion", () => {
  describe("#given a ulw-research invocation", () => {
    it("#when research is mentioned #then the ultimate-browsing companion rides behind the research pointer", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "ulw research the gateway options")

      // then
      expectPointerInjections(pi, result, [RESEARCH, COMPANION])
      const companion = injectedContent(pi, ULTIMATE_BROWSING_CUSTOM_TYPE)
      expect(companion).toContain("ulw-research")
      expect(companion).toContain('load_skills: ["ultimate-browsing"]')
    })

    it("#when the prompt is a raw /skill:ulw-research command #then only the companion is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "/skill:ulw-research the gateway options")

      // then
      expectPointerInjections(pi, result, [COMPANION])
    })

    it("#when the prompt carries an expanded ulw-research block #then only the companion is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(
        pi,
        '<skill name="ulw-research" path="skills/ulw-research/SKILL.md">skill body mentioning ulw research</skill> now run it',
      )

      // then
      expectPointerInjections(pi, result, [COMPANION])
    })

    it("#when mass ulw research is mentioned #then the companion is injected once, after every keyword pointer", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw research the gateway options, then ulw research it again")

      // then
      expectPointerInjections(pi, result, [
        { customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" },
        RESEARCH,
        COMPANION,
      ])
    })

    it("#when the prompt is queued mid-stream #then both pointers ride inside the transformed text", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "ulw research the gateway options", "interactive", "followUp")

      // then
      expect(pi.messages).toHaveLength(0)
      if (result.action !== "transform") {
        throw new Error("expected the queued prompt to be transformed")
      }
      expect(result.text.startsWith("ulw research the gateway options\n")).toBe(true)
      expect(result.text.indexOf("<omo-ulw-research-pointer>")).toBeLessThan(result.text.indexOf("<omo-ultimate-browsing-pointer>"))
      expect(result.text).toContain("ultimate-browsing/SKILL.md")
    })
  })

  describe("#given the companion is already loaded", () => {
    it("#when the prompt carries an expanded ultimate-browsing block #then the companion is not re-injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(
        pi,
        '<skill name="ultimate-browsing" path="skills/ultimate-browsing/SKILL.md">tiers</skill> ulw research the gateway options',
      )

      // then
      expectPointerInjections(pi, result, [RESEARCH])
    })

    it("#when the prompt is a raw /skill:ultimate-browsing command mentioning ulw research #then the companion is not injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "/skill:ultimate-browsing then ulw research the fallout")

      // then
      expectPointerInjections(pi, result, [RESEARCH])
    })
  })

  describe("#given no ulw-research invocation", () => {
    it("#when ultimate-browsing is mentioned on its own #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "use ultimate-browsing to screenshot the page")

      // then
      expectNoInjection(pi, result)
    })

    it("#when only ulw-loop is mentioned #then no companion is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "ulw loop ship the refactor")

      // then
      expectPointerInjections(pi, result, [{ customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" }])
    })
  })
})
