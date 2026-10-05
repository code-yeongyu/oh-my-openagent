/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  matchedSkillPointerNames,
  SKILL_POINTERS_DISABLED_FLAG,
  ULTIMATE_BROWSING_CUSTOM_TYPE,
  ULW_LOOP_CUSTOM_TYPE,
  ULW_RESEARCH_CUSTOM_TYPE,
} from "./index"
import { dispatchInput, expectNoInjection, expectPointerInjections, registerSkillPointers } from "./test-support"

describe("omo-senpi skill-pointers suppression", () => {
  describe("#given quoted and relayed mentions", () => {
    it("#when a mention is inside inline code #then no pointer is injected", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      for (const text of ["explain `ulw-loop` without running it", "explain ``ulw-loop `status` ``"]) {
        expect(matchedSkillPointerNames(text)).toEqual([])
        expectNoInjection(pi, await dispatchInput(pi, text))
      }
    })

    it("#when a mention is inside a fenced code block #then no pointer is injected", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      for (const text of [
        "review this log:\n```text\nulw-loop\n```",
        "~~~text\nulw-loop\n~~~",
        "````text\n```\nulw-loop\n````",
        "```text\nulw-loop",
      ]) {
        expect(matchedSkillPointerNames(text)).toEqual([])
        expectNoInjection(pi, await dispatchInput(pi, text))
      }
    })

    it("#when a mention is inside a relayed pointer block #then no pointer is injected", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      for (const tag of ["omo-ulw-loop-pointer", "omo-mass-ulw-pointer", "ultrawork-mode", "omo-ultrawork-reminder"]) {
        const text = `<${tag}>ulw-loop</${tag}>`
        expect(matchedSkillPointerNames(text)).toEqual([])
        expectNoInjection(pi, await dispatchInput(pi, text))
      }
    })

    it("#when code separates skill-name fragments #then removing it does not fabricate a match", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      expectNoInjection(pi, await dispatchInput(pi, "ulw `not a request` loop"))
    })

    it("#when a request follows a quoted mention #then only the requested skill matches", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      const result = await dispatchInput(pi, "explain `ulw-plan`, then run ulw-loop")

      expectPointerInjections(pi, result, [{ customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" }])
    })

    it("#when plain prose mentions a skill #then the pointer remains harmlessly conditional", async () => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      const result = await dispatchInput(pi, "the status report mentions ulw-loop")

      expectPointerInjections(pi, result, [{ customType: ULW_LOOP_CUSTOM_TYPE, skillName: "ulw-loop" }])
      expect(pi.messages[0]?.message["content"]).toEndWith("</omo-ulw-loop-pointer>")
    })
  })

  describe("#given suppression conditions", () => {
    it("#when the source is extension #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw loop from extension", "extension")

      // then
      expectNoInjection(pi, result)
    })

    it("#when the prompt is a raw /skill: command for the only matched skill #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "/skill:mass-ulw run the graph")

      // then
      expectNoInjection(pi, result)
    })

    it("#when /skill:ulw-loop args mention ulw research #then the research pointer and its companion are injected, not ulw-loop's", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "/skill:ulw-loop then ulw research the fallout")

      // then
      expectPointerInjections(pi, result, [
        { customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research" },
        { customType: ULTIMATE_BROWSING_CUSTOM_TYPE, skillName: "ultimate-browsing" },
      ])
    })

    it("#when the prompt carries an expanded skill block #then that skill is not re-injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(
        pi,
        '<skill name="mass-ulw" path="skills/mass-ulw/SKILL.md">skill body mentioning mass ulw</skill> now run it',
      )

      // then
      expectNoInjection(pi, result)
    })

    it("#when the component flag is disabled #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      pi.setFlag(SKILL_POINTERS_DISABLED_FLAG, true)
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw loop ship it")

      // then
      expectNoInjection(pi, result)
    })

    it("#when the text has no keyword #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "ordinary follow-up")

      // then
      expectNoInjection(pi, result)
    })
  })
})
