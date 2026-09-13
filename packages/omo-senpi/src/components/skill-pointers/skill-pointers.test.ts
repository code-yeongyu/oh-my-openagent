/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  MASS_ULW_CUSTOM_TYPE,
  matchedSkillPointerNames,
  ULTIMATE_BROWSING_CUSTOM_TYPE,
  ULW_LOOP_CUSTOM_TYPE,
  ULW_PLAN_CUSTOM_TYPE,
  ULW_RESEARCH_CUSTOM_TYPE,
} from "./index"
import { dispatchInput, expectPointerInjections, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers component", () => {
  describe("#given the keyword table", () => {
    it("#when given mass-ulw trigger spellings #then mass-ulw matches", () => {
      const triggers = [
        "mass ulw",
        "massulw",
        "MASS ULW",
        "Mass-Ulw",
        "mass  ulw",
        "run mass ulw now",
        "mass-ulw",
        "ulw mass",
        "ulwmass",
        "mulw",
        "meth",
      ] as const
      for (const text of triggers) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["mass-ulw"] })
      }
    })

    it("#when given ulw-plan trigger spellings #then ulw-plan matches", () => {
      const triggers = ["ulw plan", "ulw-plan", "ulwplan", "ULW PLAN", "Ulw-Plan", "go ulw plan the migration"] as const
      for (const text of triggers) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["ulw-plan"] })
      }
    })

    it("#when given ulw-loop trigger spellings #then ulw-loop matches", () => {
      const triggers = ["ulw loop", "ulw-loop", "ulwloop", "ULW LOOP", "ulw  loop", "go ulw loop"] as const
      for (const text of triggers) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["ulw-loop"] })
      }
    })

    it("#when given ulw-research trigger spellings #then ulw-research matches", () => {
      const triggers = ["ulw research", "ulw-research", "ulwresearch", "ULW RESEARCH"] as const
      for (const text of triggers) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: ["ulw-research"] })
      }
    })

    it("#when keywords overlap #then every mentioned skill matches in table order", () => {
      const cases = [
        { text: "mass ulw loop", matched: ["mass-ulw", "ulw-loop"] },
        { text: "mass ulw-loop", matched: ["mass-ulw", "ulw-loop"] },
        { text: "mass ulw research", matched: ["mass-ulw", "ulw-research"] },
        { text: "mulw research", matched: ["mass-ulw", "ulw-research"] },
        { text: "meth research", matched: ["mass-ulw", "ulw-research"] },
        { text: "ulw mass research", matched: ["mass-ulw", "ulw-research"] },
        { text: "ulwmass-research", matched: ["mass-ulw", "ulw-research"] },
        { text: "MULW RESEARCH", matched: ["mass-ulw", "ulw-research"] },
        { text: "mass ulw plan it out", matched: ["mass-ulw", "ulw-plan"] },
        { text: "ulw loop then ulw research", matched: ["ulw-loop", "ulw-research"] },
        { text: "ulw research first, ulw loop second", matched: ["ulw-loop", "ulw-research"] },
        { text: "make pr work until gets merged go ulw loop", matched: ["ulw-loop"] },
      ] as const
      for (const { text, matched } of cases) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: [...matched] })
      }
    })

    it("#when given near-miss spellings #then nothing matches", () => {
      const misses = [
        "ulw",
        "ultrawork",
        "the mass of ulw",
        "ulw massive",
        "ulwmassive",
        "simulw",
        "mulwark",
        "method",
        "methods",
        "methane",
        "promethean",
        "amethyst",
        "ulw-looper",
        "ulwloops go brr",
        "ulw planning session",
        "loop ulw",
        "research ulw",
        "kulw loop of yarn",
        "just loop it",
      ] as const
      for (const text of misses) {
        expect({ text, matched: matchedSkillPointerNames(text) }).toEqual({ text, matched: [] })
      }
    })
  })

  describe("#given a matching interactive prompt", () => {
    it("#when the user requests a skill #then one hidden conditional pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw ship the docs refresh")

      // then
      expectPointerInjections(pi, result, [{ customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" }])
      const content = pi.messages[0]?.message["content"]
      expect(content).toEndWith("</omo-mass-ulw-pointer>")
      expect(content).toContain("If the user of this session is asking to run mass-ulw")
    })

    it("#when the mass-ulw pointer is injected #then it points at the packaged skill", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      await dispatchInput(pi, "mass ulw ship it")

      // then
      const content = pi.messages[0]?.message["content"]
      if (typeof content !== "string") throw new Error("expected string content")
      expect(content).toContain("mass-ulw/SKILL.md")
      expect(content).toEndWith("</omo-mass-ulw-pointer>")
    })

    it("#when ulw-loop and mass-ulw pointers are injected #then only ulw-loop points at the registered toolkit tool", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      await dispatchInput(pi, "mass ulw-loop ship the refactor")

      // then
      const massContent = pi.messages[0]?.message["content"]
      const loopContent = pi.messages[1]?.message["content"]
      if (typeof massContent !== "string" || typeof loopContent !== "string") {
        throw new Error("expected string skill-pointer messages")
      }
      expect(loopContent).toContain("tool.omo_agent_toolkit")
      expect(loopContent).not.toContain("runtime/agent-toolkit")
      expect(massContent).not.toContain("tool.omo_agent_toolkit")
    })

    it("#when overlapping keywords are mentioned #then one pointer per skill is injected in table order", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw-loop ship the refactor")

      // then
      expectPointerInjections(pi, result, [
        { customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" },
        { customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" },
      ])
    })

    it("#when ulw plan is mentioned #then the plan pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "go ulw plan the migration")

      // then
      expectPointerInjections(pi, result, [{ customType: ULW_PLAN_CUSTOM_TYPE, skillName: "ulw-plan" }])
    })

    it("#when research is mentioned #then the research pointer and its browsing companion are injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw research the gateway options")

      // then
      expectPointerInjections(pi, result, [
        { customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" },
        { customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research" },
        { customType: ULTIMATE_BROWSING_CUSTOM_TYPE, skillName: "ultimate-browsing" },
      ])
    })
  })
})
