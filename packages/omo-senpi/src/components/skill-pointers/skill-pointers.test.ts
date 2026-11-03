/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  BROWSER_CUSTOM_TYPE,
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
    it("#when the user requests mass-ulw #then one hidden binding mode block is injected", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "run mass ulw on the docs refresh")

      // then
      expectPointerInjections(pi, result, [{ customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw", mode: true }])
      const content = pi.messages[0]?.message["content"]
      expect(content).toEndWith("</omo-mass-ulw-mode>")
    })

    it("#when the mass-ulw mode block is injected #then it points at the packaged skill", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      await dispatchInput(pi, "/mass-ulw ship it")

      // then
      const content = pi.messages[0]?.message["content"]
      if (typeof content !== "string") throw new Error("expected string content")
      expect(content).toContain("mass-ulw/SKILL.md")
      expect(content).toEndWith("</omo-mass-ulw-mode>")
    })

    it("#when ulw-loop and mass-ulw pointers are injected #then only ulw-loop teaches the eval SDK import", async () => {
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
      expect(loopContent).toContain('await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)')
      expect(loopContent).not.toMatch(/tool\.omo_agent_toolkit/)
      expect(loopContent).not.toContain("runtime/agent-toolkit")
      expect(massContent).not.toContain("OMO_AGENT_TOOLKIT_SDK_ROOT")
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
        { customType: BROWSER_CUSTOM_TYPE, skillName: "browser" },
        { customType: ULTIMATE_BROWSING_CUSTOM_TYPE, skillName: "ultimate-browsing" },
      ])
    })
  })

  // #10810: the real run's prompt got an ignorable pointer, and the model never read mass-ulw or started a
  // workflow run. #10822: binding is limited to two fixed forms, because a false bind forces a workflow run
  // onto a session that only read the name, while a missed bind costs a retyped prompt. The `<omo-*-mode>`
  // tag is the machine sentinel for a binding block: the quote stripper keys on it so a pasted or relayed
  // block never re-arms, and the live QA drivers count it.
  describe("#given the binding table", () => {
    const modesOf = async (text: string): Promise<string[]> => {
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)
      await dispatchInput(pi, text)
      return pi.messages
        .map((call) => String(call.message["content"]))
        .flatMap((content) => /^<(omo-[a-z-]+-mode)>/.exec(content)?.[1] ?? [])
    }

    it("#when the prompt is the slash command or opens with a listed verb directly before the keyword #then it binds", async () => {
      const MASS = ["omo-mass-ulw-mode"]
      const BOTH = ["omo-mass-ulw-mode", "omo-ulw-research-mode"]
      for (const [text, modes] of [
        ["/mass-ulw split the docs refresh into lanes", MASS],
        ["/mulw fix the flaky suite", MASS],
        ["/ulw-research compare the gateway options", ["omo-ulw-research-mode"]],
        ["/mulw research the gateway options", BOTH],
        ["run mass ulw research https://www.youtube.com/watch?v=abc and recreate it", BOTH],
        ["run mass ulw on index.ts. Then report", MASS],
        ["run mass ulw on the flaky suite", MASS],
        ["Run mass-ulw", MASS],
        ["start mass ulw: fix the flaky suite", MASS],
        ["use mass-ulw to split the docs refresh into lanes", MASS],
        ["do mass ulw research on the housing market", BOTH],
        ["execute mass ulw research for this video", BOTH],
        ["use ulw-research to compare the gateway options", ["omo-ulw-research-mode"]],
        ["[Image #1] run mass ulw on this", MASS],
        // Korean: the keyword, then exactly one request ending closing the sentence.
        ["mass ulw 돌려줘", MASS],
        ["mass ulw로 실행해줘", MASS],
        ["mass ulw 써줘.", MASS],
        ["mass ulw 해줘", MASS],
        ["mass ulw 돌려", MASS],
        ["ulw research 실행해", ["omo-ulw-research-mode"]],
        ["mass ulw research 돌려줘\n결과는 표로 정리", BOTH],
      ] as const) {
        expect({ text, modes: await modesOf(text) }).toEqual({ text, modes: [...modes] })
      }
    })

    it("#when the prompt is anything else #then no mode binds and the conditional pointers stay", async () => {
      for (const [text, pointers] of [
        // The #10810 prompt types the keyword last; it keeps the pointer and the user retypes with a verb.
        ["https://www.youtube.com/live/qt5p-_tE8d0 How is this possible? Recreate it in 3D. mass ulw research", ["mass-ulw", "ulw-research"]],
        // Keyword-first statements and questions (#10822 review H1).
        ["mass ulw is broken in this repo, can you look into it?", ["mass-ulw"]],
        ["Mass ulw keeps failing on my machine", ["mass-ulw"]],
        ["mass ulw research didn't start a workflow yesterday. why", ["mass-ulw", "ulw-research"]],
        ["mass ulw fix the flaky suite", ["mass-ulw"]],
        // Keyword-last statements and questions (H2).
        ["how do I use mass ulw", ["mass-ulw"]],
        ["I really hate mass ulw", ["mass-ulw"]],
        ["Fix the flaky suite, mass ulw.", ["mass-ulw"]],
        ["is ulw research any good? I tried ulw research", ["ulw-research"]],
        // Negated (H3) and verb-plus-noun forms (M1).
        ["please don't do mass ulw research", []],
        ["Use mass-ulw's docs to explain the planner", ["mass-ulw"]],
        ["run the mass-ulw test suite", ["mass-ulw"]],
        ["Do mass ulw tests pass on dev?", ["mass-ulw"]],
        ["Use ulw research results from yesterday to write the summary", ["ulw-research"]],
        ["run mass ulw on dev?", ["mass-ulw"]],
        ["run mass ulw on index.ts?", ["mass-ulw"]],
        ["use mass ulw. Is that the right choice?", ["mass-ulw"]],
        ["/mass-ulw is this the right tool?", []],
        ["run mass ulw on it. 이거 맞아？", ["mass-ulw"]],
        ["run mass ulw.ts again", []],
        ["use mass ulw.md as the reference", []],
        ["Why is the suite flaky? run mass ulw on it", ["mass-ulw"]],
        ["mass ulw로 해줘. 근데 이게 맞아?", ["mass-ulw"]],
        ["run mass ulw on v1.2 of the planner?", ["mass-ulw"]],
        // Korean questions and past-tense statements (#10822 round-5 review).
        ["mass ulw 돌려도 돼?", ["mass-ulw"]],
        ["mass ulw를 돌려볼까?", ["mass-ulw"]],
        ["mass ulw 돌려봤는데 안 되네", ["mass-ulw"]],
        ["mass ulw 써서 만든 결과가 이상해", ["mass-ulw"]],
        ["mass ulw 실행해줘?", ["mass-ulw"]],
        ["mass ulw 돌렸어", ["mass-ulw"]],
        ["mass ulw 했어", ["mass-ulw"]],
        ["mass ulw 하나", ["mass-ulw"]],
        ["mass ulw 하니", ["mass-ulw"]],
        ["mass ulw 했는데 결과가 없어", ["mass-ulw"]],
        ["mass ulw 돌려봐", ["mass-ulw"]],
        ["mass ulw 실행해주세요", ["mass-ulw"]],
        ["mass ulw 돌려줘서 고마워", ["mass-ulw"]],
        // A bracketed prose arrow is not a relay header: the text keeps its pointer.
        ["[step 1 -> step 2] run mass ulw on this migration", ["mass-ulw"]],
        // A verb that does not open the prompt, and 'in ...' forms.
        ["The suite is flaky. Run mass-ulw on it and report back", ["mass-ulw"]],
        ["please use mass-ulw to split the docs refresh", ["mass-ulw"]],
        ["fix the flaky suite in mass ulw", ["mass-ulw"]],
        // Statements and questions that name the skill.
        ["Fix the bug in the mass-ulw skill pointer.", ["mass-ulw"]],
        ["what is mass ulw research at https://example.com?", ["mass-ulw", "ulw-research"]],
        ["how does mass ulw differ from ulw-loop?", ["mass-ulw"]],
        ["meth ship the docs refresh", ["mass-ulw"]],
        // Quotes and relays: a quoted test name, relay headers, and the two relays that bound a coordinator session (#10822).
        ["the failing test is 'run mass ulw research > binds both'", []],
        ["[LEAD via coordinator -> lane-a, omo#1 FIX_FIRST] run mass ulw research on the fix", []],
        ["[lane-a w46:p6P] ran mass ulw on the docs refresh", ["mass-ulw"]],
        ["[mass-ulw-hard-trigger lane-a] omo#1 SIMPLIFY ack, implementing now. One consequence for the lead: the motivating prompt itself ('<url> How is this possible? Recreate it in 3D. mass ulw research', keyword LAST) will NOT bind under (a)/(b); it gets the pointer only ...", []],
        ["[lane-r3 -> coordinator + ledger-lane] (1) the one-time copy STARTED. (2) no parser bug: the recorded names are exact, and the other is 'omo-senpi ultrawork packaged reload > ...'; mass ulw research is next.\n[lane-r3 -> coordinator + ledger-lane] the rerun is filed.", []],
      ] as const) {
        // given
        const pi = new FakeExtensionAPI()
        await registerSkillPointers(pi)

        // when
        await dispatchInput(pi, text)

        // then
        const contents = pi.messages.map((call) => String(call.message["content"]))
        expect({ text, modes: contents.filter((content) => /^<omo-[a-z-]+-mode>/.test(content)) }).toEqual({ text, modes: [] })
        for (const skill of pointers) expect({ text, skill, found: contents.some((content) => content.startsWith(`<omo-${skill}-pointer>`)) }).toEqual({ text, skill, found: true })
      }
    })

    it("#when a binding prompt also names research #then mass-ulw and ulw-research bind with their companions behind them", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      // when
      const result = await dispatchInput(pi, "run mass ulw research on https://www.youtube.com/live/qt5p-_tE8d0 and recreate it in 3D")

      // then
      expectPointerInjections(pi, result, [
        { customType: MASS_ULW_CUSTOM_TYPE, skillName: "mass-ulw", mode: true },
        { customType: ULW_RESEARCH_CUSTOM_TYPE, skillName: "ulw-research", mode: true },
        { customType: BROWSER_CUSTOM_TYPE, skillName: "browser" },
        { customType: ULTIMATE_BROWSING_CUSTOM_TYPE, skillName: "ultimate-browsing" },
      ])
      const [mass, research] = pi.messages.map((call) => String(call.message["content"]))
      expect(mass).toStartWith("<omo-mass-ulw-mode>")
      expect(mass).toEndWith("</omo-mass-ulw-mode>")
      expect(research).toStartWith("<omo-ulw-research-mode>")
      expect(research).toEndWith("</omo-ulw-research-mode>")
    })

    it("#when a prompt carries an injected mode block #then the block's own mention does not re-arm", async () => {
      // given
      const pi = new FakeExtensionAPI()
      await registerSkillPointers(pi)

      for (const tag of ["omo-mass-ulw-mode", "omo-ulw-research-mode"]) {
        const text = `<${tag}>mass ulw research</${tag}>`

        // when / then
        expect(matchedSkillPointerNames(text)).toEqual([])
        expect(await dispatchInput(pi, text)).toEqual({ action: "continue" })
        expect(pi.messages).toHaveLength(0)
      }
    })
  })
})
