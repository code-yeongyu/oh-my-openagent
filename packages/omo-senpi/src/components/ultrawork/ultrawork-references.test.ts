/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { classifyUltraworkInput } from "./index"
import {
  dispatchInput,
  expectHiddenInjection,
  expectNoInjection,
  registerIsolatedUltrawork,
} from "./ultrawork.test-support"

const fresh = { wasArmed: false, compactRearmPending: false } as const
const classify = (text: string) => classifyUltraworkInput({ text, source: "interactive" }, fresh)

// #9738 / #9740: a skill name used inside a longer identifier, or named only to forbid it, is a
// reference, not a request. These cases decide arming through the real input handler.
describe("omo-senpi ultrawork references do not arm", () => {
  it("#given identifier and path references #when classified #then none arms and the reason says why", () => {
    for (const text of [
      "what happened in the mass-ulw-refactor session yesterday?",
      "in a mass-ulw research pipeline, answer one sub-question",
      "write the result to .omo/ulw/browser-gaps/notes.md",
      "the ledger is at .omo/ulw-execute/ledger.jsonl",
      "branch fix/ulw-plan-gate has the change",
      "the senpi-ulw-loop lane finished",
      "what happened in the ulw-plan-refactor session yesterday?",
      "open ulw-plan.md and summarize it",
      "summarize ulw.md",
      "the ulw-research_v2 file",
      "the mass-ulw-loop-runner session finished",
      "senpi-mass-ulw lane",
      "amass-ulw notes",
      "mass-ulw the migration",
    ]) {
      expect({ text, effective: classify(text).effective }).toEqual({ text, effective: false })
      expect(classify(text).suppressionReason).toBe("identifier_reference")
    }
  })

  it("#given a skill named only to forbid it #when classified #then it does not arm, including across a comma", () => {
    for (const text of [
      "Do not load mass-ulw or ulw-research or launch your own workflow.",
      "Don't use ulw for this, just answer",
      "never run ulw-loop, ultrawork, or any skill here",
    ]) {
      expect({ text, effective: classify(text).effective }).toEqual({ text, effective: false })
      expect(classify(text).suppressionReason).toBe("negated_mention")
    }
  })

  // #14389: pasted advice that forbids the mode armed it. A prohibition word right before the keyword
  // ("avoid ulw", "no ultrawork", a bulleted rule list) is advice, not a request.
  it("#given advice that forbids the mode without a 'do not use' verb #when classified #then it does not arm", () => {
    for (const text of [
      "avoid ulw for small fixes",
      "No ultrawork here, a quick answer is enough.",
      "skip ulw this time",
      "answer without ultrawork",
      "don't ulw this one",
      "never ultrawork a one-line change",
      "avoid using ulw or mass-ulw on this repo",
      "skip ulw, ulw-loop and ultrawork here",
      "Rules from the guide:\n- avoid ulw on tiny tasks\n- no ultrawork for docs\n- skip ulw-loop when unsure",
    ]) {
      expect({ text, effective: classify(text).effective }).toEqual({ text, effective: false })
      expect(classify(text).suppressionReason).toBe("negated_mention")
    }
  })

  it("#given a URL or a code span carrying the bare keyword #when classified #then it does not arm", () => {
    for (const text of ["see https://example.com/search?q=ulw&page=2", "the flag is `ulw` in the config"]) {
      expect({ text, effective: classify(text).effective }).toEqual({ text, effective: false })
    }
  })

  it("#given real requests #when classified #then each still arms", () => {
    for (const text of [
      "ulw-loop fix the flaky test",
      "ulw-plan the migration",
      "ulw-execute the plan",
      "ulw",
      "ULW fix it",
      "ULTRAWORK: ship the release",
      "이거 끝까지 해줘 ulw",
      "mass ulw research the market",
      "can you ulw this refactor for me",
      "Don't use tmux. ulw this",
      "do not stop until done, ulw",
      "Do not use tmux, but ulw the fix",
      "don’t use tmux — ulw this",
      "never mind, ulw this",
      "don't run the old one; ulw the new one",
      "ulw fix src/foo.ts",
      "ulw-loop.",
      "ulw-plan.",
      "avoid regressions, ulw the fix",
      "no worries, ulw this",
      "skip the docs. ulw the fix",
      // The prohibition covers only the keyword list it names; a comma then a request still arms (#14392 review M1).
      "No ulw-loop, just ulw this",
      "skip ulw-plan, ulw the fix",
      "without ultrawork the answer was bad, so ulw this",
    ]) {
      expect({ text, effective: classify(text).effective }).toEqual({ text, effective: true })
    }
  })

  it("#given a long input of URL-like runs #when masked #then it stays linear", () => {
    const long = "a.".repeat(100_000)
    const started = performance.now()
    classify(long)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it("#given a reference and a request in one message #when dispatched #then the request arms", async () => {
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    expectHiddenInjection(pi, await dispatchInput(pi, "check .omo/ulw/notes.md, then ulw the fix", "interactive"))
  })

  it("#given only references #when dispatched through the input handler #then nothing is injected", async () => {
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    expectNoInjection(
      pi,
      await dispatchInput(pi, "Do not load mass-ulw or ulw-research. Results go to .omo/ulw/x.md", "interactive"),
    )
  })
})
