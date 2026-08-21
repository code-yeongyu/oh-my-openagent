/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createMassUlwComponent, isMassUlwInput, MASS_ULW_CUSTOM_TYPE, MASS_ULW_DISABLED_FLAG } from "./index"

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

async function registerMassUlw(pi: FakeExtensionAPI): Promise<void> {
  await createMassUlwComponent().register(pi, createTestContext(pi))
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

function expectSkillPointerInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(1)
  const [call] = pi.messages
  expect(call?.message["customType"]).toBe(MASS_ULW_CUSTOM_TYPE)
  expect(call?.message["display"]).toBe(false)
  const content = call?.message["content"]
  if (typeof content !== "string") {
    throw new Error("expected a string skill-pointer message")
  }
  expect(content).toContain("mass-ulw/SKILL.md")
  expect(content).toContain("read tool")
}

function expectNoInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(0)
}

describe("omo-senpi mass-ulw component", () => {
  describe("#given the keyword detector", () => {
    it("#when given trigger spellings #then each matches", () => {
      const triggers = [
        "mass ulw",
        "massulw",
        "MASS ULW",
        "Mass-Ulw",
        "mass  ulw",
        "run mass ulw now",
        "mass-ulw",
        "mass ulw, then report back",
        "ulw mass",
        "ulwmass",
        "ULW MASS",
        "Ulw-Mass",
        "ulw  mass",
        "go ulw mass now",
        "mulw",
        "MULW",
        "run mulw now",
        "meth",
        "METH",
        "meth, then report back",
      ] as const
      for (const text of triggers) {
        expect({ text, matched: isMassUlwInput(text) }).toEqual({ text, matched: true })
      }
    })

    it("#when given near-miss spellings #then none match", () => {
      const misses = [
        "",
        "mass",
        "ulw",
        "ultrawork",
        "massive ulw",
        "xmassulw",
        "mass ulw2",
        "massachusetts",
        "mass ulw-loop is separate",
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
      ] as const
      for (const text of misses) {
        expect({ text, matched: isMassUlwInput(text) }).toEqual({ text, matched: false })
      }
    })
  })

  describe("#given a matching interactive prompt", () => {
    it("#when dispatched #then one hidden skill-pointer message is injected and the text is untouched", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw ship the docs refresh")

      // then
      expectSkillPointerInjection(pi, result)
    })

    it("#when the spelling is massulw #then the same pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "MASSULW time")

      // then
      expectSkillPointerInjection(pi, result)
    })

    it("#when the spelling is a short alias like meth #then the same pointer is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "meth ship the docs refresh")

      // then
      expectSkillPointerInjection(pi, result)
    })
  })

  describe("#given a queued prompt", () => {
    it("#when streamingBehavior is set #then the pointer rides inside the same message", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw queued work", "interactive", "steer")

      // then
      expect(result.action).toBe("transform")
      if (result.action !== "transform") throw new Error("expected transform")
      expect(result.text).toMatch(/^mass ulw queued work\n/)
      expect(result.text).toContain("mass-ulw/SKILL.md")
      expect(pi.messages).toHaveLength(0)
    })
  })

  describe("#given suppression conditions", () => {
    it("#when the source is extension #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw from extension", "extension")

      // then
      expectNoInjection(pi, result)
    })

    it("#when the prompt is the raw /skill:mass-ulw command #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "/skill:mass-ulw run the graph")

      // then
      expectNoInjection(pi, result)
    })

    it("#when the prompt carries an expanded mass-ulw skill block #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

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
      pi.setFlag(MASS_ULW_DISABLED_FLAG, true)
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "mass ulw ship it")

      // then
      expectNoInjection(pi, result)
    })

    it("#when the text has no keyword #then nothing is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerMassUlw(pi)

      // when
      const result = await dispatchInput(pi, "ordinary follow-up")

      // then
      expectNoInjection(pi, result)
    })
  })
})
