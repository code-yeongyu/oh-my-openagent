/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import {
  createSkillPointersComponent,
  MASS_ULW_CUSTOM_TYPE,
  matchedSkillPointerNames,
  SKILL_POINTERS_DISABLED_FLAG,
  ULW_LOOP_CUSTOM_TYPE,
  ULW_PLAN_CUSTOM_TYPE,
  ULW_RESEARCH_CUSTOM_TYPE,
} from "./index"

type InputDispatchResult = { action: "continue" } | { action: "transform"; text: string }

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = {
    info() {},
    warn() {},
    error() {},
  }
  return {
    logger,
    config: {
      getFlag(name) {
        return pi.getFlag(name)
      },
    },
  }
}

async function registerSkillPointers(pi: FakeExtensionAPI): Promise<void> {
  await createSkillPointersComponent().register(pi, createTestContext(pi))
}

async function dispatchInput(
  pi: FakeExtensionAPI,
  text: unknown,
  source: unknown = "interactive",
  streamingBehavior?: unknown,
): Promise<InputDispatchResult> {
  const [result] = await pi.dispatch("input", {
    type: "input",
    text,
    source,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
  })
  return result as InputDispatchResult
}

function expectPointerInjections(pi: FakeExtensionAPI, result: unknown, expected: readonly { customType: string; skillName: string }[]): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(expected.length)
  expect(pi.messages.map((call) => call.message["customType"])).toEqual(expected.map((entry) => entry.customType))
  for (const [index, entry] of expected.entries()) {
    const call = pi.messages[index]
    expect(call?.message["display"]).toBe(false)
    const content = call?.message["content"]
    if (typeof content !== "string") {
      throw new Error("expected a string skill-pointer message")
    }
    expect(content).toContain(`${entry.skillName}/SKILL.md`)
    expect(content).toContain("read tool")
  }
}

function expectNoInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(0)
}

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
    it("#when one skill is mentioned #then one hidden pointer is injected and the text is untouched", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw ship the docs refresh")

      // then
      expectPointerInjections(pi, result, [{ customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" }])
    })

    it("#when the mass-ulw pointer is injected #then it still instructs workflow orchestration", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      await dispatchInput(pi, "mass ulw ship it")

      // then
      const content = pi.messages[0]?.message["content"]
      if (typeof content !== "string") throw new Error("expected string content")
      expect(content).toContain("workflow tool")
    })

    it("#when ulw-loop and mass-ulw pointers are injected #then only ulw-loop includes the resolved CLI shim", async () => {
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
      expect(loopContent).toContain("runtime/agent-toolkit/omo-agent-toolkit")
      expect(loopContent).toContain("ulw-loop <subcommand>")
      expect(massContent).not.toContain("runtime/agent-toolkit")
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

    it("#when research is mentioned #then the research pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw research the gateway options")

      // then
      expectPointerInjections(pi, result, [
        { customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw" },
        { customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research" },
      ])
    })
  })

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

    it("#when /skill:ulw-loop args mention ulw research #then only the research pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "/skill:ulw-loop then ulw research the fallout")

      // then
      expectPointerInjections(pi, result, [{ customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research" }])
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
