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
  eventCtx?: unknown,
): Promise<InputDispatchResult> {
  const [result] = await pi.dispatch("input", {
    type: "input",
    text,
    source,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
  }, eventCtx)
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
    expect(content).toContain(`<omo-${entry.skillName}-pointer>`)
    expect(content).toContain(`${entry.skillName}/SKILL.md`)
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
      expect(loopContent).not.toContain("--session-id")
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
      expect(content).toContain("--session-id session-a-weird")
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
      expect(result.text).toContain("--session-id new-session")
      expect(result.text).not.toContain("--session-id previous-session")
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
