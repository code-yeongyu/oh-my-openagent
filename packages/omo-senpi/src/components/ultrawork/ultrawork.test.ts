/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { FORBIDDEN_DIRECTIVE_TOKENS, SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"
import { classifyUltraworkInput, isUltraworkInput } from "./index"
import {
  dispatchInput,
  expectAtomicQueuedInjection,
  expectHiddenInjection,
  expectNoInjection,
  markerCount,
  registerIsolatedUltrawork,
} from "./ultrawork.test-support"

const generatedDirectivePath = resolve("packages/omo-senpi/src/components/ultrawork/generated-directive.ts")

describe("omo-senpi ultrawork component", () => {
  it("#given a fixed prompt corpus #when pure classification runs #then keyword matching stays in parity with the shipped detector", () => {
    const corpus = [
      "",
      "ulw",
      "ULW",
      "ultrawork",
      "ULTRAWORK",
      "ulw-plan",
      "ulw-loop",
      "ulw-research",
      "ulwultrawork",
      "ULW ulw Ultrawork",
      "plan only",
      "하이ulw",
      "ulw_helper.ts",
      "before ultrawork after",
      "/skill:ultrawork",
      "/skill:frontend ulw polish",
      "/skill:myulw run it",
      "(ulw) [ultrawork] {ulw}",
      ".*+?^${}()|[]\\ ulw",
      "울트라워크",
      "nulw-plan",
      "ulw--plan",
      "ulw\nultrawork",
      "x".repeat(100_000),
    ] as const

    for (const text of corpus) {
      const classification = classifyUltraworkInput(
        { text, source: "interactive" },
        { wasArmed: false, compactRearmPending: false },
      )
      expect({ text, classified: classification.matchedUlw || classification.matchedUltrawork }).toEqual({
        text,
        classified: isUltraworkInput(text),
      })
    }
  })

  it("#given overlapping and repeated variants #when classified #then one shipped global pattern determines variants and occurrence count", () => {
    const cases = [
      { text: "ulwultrawork", matchedUlw: true, matchedUltrawork: true, occurrenceCount: 2 },
      { text: "ULW ulw Ultrawork", matchedUlw: true, matchedUltrawork: true, occurrenceCount: 3 },
      { text: "ulw-plan", matchedUlw: false, matchedUltrawork: false, occurrenceCount: 0 },
    ] as const

    for (const { text, ...expected } of cases) {
      expect(
        classifyUltraworkInput(
          { text, source: "interactive" },
          { wasArmed: false, compactRearmPending: false },
        ),
      ).toMatchObject(expected)
    }
  })

  it("#given direct, skill, block, and extension inputs #when classified #then effectiveness and suppression mirror handler routes", () => {
    const cases = [
      {
        input: { text: "ulw ship it", source: "interactive" as const },
        effective: true,
        route: "direct",
        suppressionReason: "none",
        stage: "first_arm",
      },
      {
        input: { text: "/skill:frontend ulw polish", source: "interactive" as const },
        effective: true,
        route: "skill_args",
        suppressionReason: "none",
        stage: "first_arm",
      },
      {
        input: { text: "/skill:myulw run it", source: "interactive" as const },
        effective: false,
        route: "none",
        suppressionReason: "skill_name_only",
        stage: "none",
      },
      {
        input: { text: "/skill:ultrawork fix it", source: "interactive" as const },
        effective: false,
        route: "skill_expansion",
        suppressionReason: "skill_expansion",
        stage: "none",
      },
      {
        input: { text: "<ultrawork-mode>rules</ultrawork-mode> ulw", source: "interactive" as const },
        effective: false,
        route: "embedded_directive",
        suppressionReason: "embedded_directive",
        stage: "none",
      },
      {
        input: { text: "ulw from extension", source: "extension" as const },
        effective: false,
        route: "none",
        suppressionReason: "extension_source",
        stage: "none",
      },
    ] as const

    for (const { input, ...expected } of cases) {
      expect(classifyUltraworkInput(input, { wasArmed: false, compactRearmPending: false })).toMatchObject(expected)
    }
  })

  it("#given identical stale snapshots #when pure classification runs twice #then results are identical without hidden module state", () => {
    const input = { text: "ULW ulw Ultrawork", source: "interactive" as const }
    const snapshot = { wasArmed: true, compactRearmPending: false }

    const first = classifyUltraworkInput(input, snapshot)
    const second = classifyUltraworkInput(input, snapshot)

    expect(first).toEqual(second)
    expect(first.stage).toBe("remention")
  })

  it("#given trigger words #when user input dispatches #then arms via one hidden custom message", async () => {
    // given
    const prompts = ["please ultrawork this", "하이ulw", "refactor ulw_helper.ts"] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await registerIsolatedUltrawork(pi)

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectHiddenInjection(pi, result)
    }
  })

  it("#given a trigger word #when the user text is dispatched #then the typed text is never rewritten", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "ulw fix the login bug"

    // when
    const result = await dispatchInput(pi, prompt)

    // then: no transform action, so senpi keeps the user's literal prompt
    expect(result).not.toMatchObject({ action: "transform" })
    expect(JSON.stringify(result)).not.toContain("<ultrawork-mode>")
  })

  it("#given an idle session #when a trigger arms #then the injection carries no delivery override", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)

    // when
    const result = await dispatchInput(pi, "ulw ship it")

    // then
    expectHiddenInjection(pi, result, undefined)
    expect(pi.messages[0]?.options?.["deliverAs"]).toBeUndefined()
  })

  it("#given a steer-queued prompt #when a trigger arms #then the directive stays atomic with the prompt", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "ulw redirect this"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "steer")

    // then
    expectAtomicQueuedInjection(pi, result, prompt)
  })

  it("#given a followUp-queued prompt #when a trigger arms #then the directive stays atomic with the prompt", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "ulw queue this"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "followUp")

    // then: a hidden message here would be drained alone and answered on its own turn
    expectAtomicQueuedInjection(pi, result, prompt)
  })

  it("#given a queued /skill: command #when a trigger arms #then the directive is appended so expansion survives", async () => {
    // given: senpi expands /skill: only while the text still STARTS with the command
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "/skill:frontend ulw 수준으로 다듬어줘"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "followUp")

    // then
    expectAtomicQueuedInjection(pi, result, prompt)
    expect(result.action === "transform" && result.text.startsWith("/skill:frontend")).toBe(true)
  })

  it("#given any queued prompt #when a trigger arms #then no hidden message is emitted for it", async () => {
    // given: senpi queues ANY defined streamingBehavior, defaulting to steer
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)

    // when
    const result = await dispatchInput(pi, "ulw odd payload", "interactive", "bogus")

    // then
    expect(pi.messages).toHaveLength(0)
    expect(result).toMatchObject({ action: "transform" })
  })

  it("#given non-trigger input #when user input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)

    // when
    const result = await dispatchInput(pi, "please explain this file")

    // then
    expectNoInjection(pi, result)
  })

  it("#given recursion guard source extension #when trigger input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)

    // when
    const result = await dispatchInput(pi, "ultrawork again", "extension")

    // then
    expectNoInjection(pi, result)
  })

  it("#given ultrawork disabled flag #when trigger input dispatches #then suppresses injection", async () => {
    // given
    const pi = new FakeExtensionAPI()
    pi.setFlag("omo-senpi-ultrawork-disabled", true)
    await registerIsolatedUltrawork(pi)

    // when
    const result = await dispatchInput(pi, "ulw fix this")

    // then
    expectNoInjection(pi, result)
  })

  it("#given malformed input #when input dispatches #then no-ops safely", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const malformedInputs: readonly unknown[] = [undefined, null, "", 42, { text: "ulw" }]

    // when
    const results: unknown[] = []
    for (const text of malformedInputs) {
      results.push(await dispatchInput(pi, text))
    }

    // then
    expect(results).toEqual([
      { action: "continue" },
      { action: "continue" },
      { action: "continue" },
      { action: "continue" },
      { action: "continue" },
    ])
    expect(pi.messages).toHaveLength(0)
  })

  it("#given ulw-prefixed skill names #when user input dispatches #then injects nothing", async () => {
    // given
    const prompts = [
      "/skill:ulw-plan 네 plan 을 작성해주세요",
      "ulw-plan 스킬 좀 검토해줘",
      "omo-agent-toolkit ulw-loop status --json 확인",
    ] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await registerIsolatedUltrawork(pi)

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectNoInjection(pi, result)
    }
  })

  it("#given input already carrying an ultrawork block #when trigger word dispatches #then does not reinject", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "이 기록 확인해줘 <ultrawork-mode>\n# Role\n</ultrawork-mode> 그리고 ulw 모드로 부탁해"

    // when
    const result = await dispatchInput(pi, prompt)

    // then
    expectNoInjection(pi, result)
  })

  it("#given /skill: command with a trigger word in args #when dispatched #then arms without touching the command text", async () => {
    // given: senpi only expands /skill: while the prompt still STARTS with the
    // command, so the hidden-message route must leave the text byte-identical.
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "/skill:frontend ulw 수준으로 다듬어줘"

    // when
    const result = await dispatchInput(pi, prompt)

    // then
    expectHiddenInjection(pi, result)
  })

  it("#given a lone open-tag mention without a closing tag #when trigger word dispatches #then still injects", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "Explain what <ultrawork-mode> means, then ulw this fix"

    // when
    const result = await dispatchInput(pi, prompt)

    // then
    expectHiddenInjection(pi, result)
  })

  it("#given the /skill:ultrawork command itself #when dispatched #then passes through untouched", async () => {
    // given: expansion inlines the full SKILL.md (whose body IS the directive);
    // injecting again would duplicate the same directive in one turn.
    const prompts = ["/skill:ultrawork fix this login bug", "/skill:ultrawork"] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await registerIsolatedUltrawork(pi)

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectNoInjection(pi, result)
    }
  })

  it("#given /skill: command whose trigger appears only in the skill name #when dispatched #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    const prompt = "/skill:myulw run it"

    // when
    const result = await dispatchInput(pi, prompt)

    // then
    expectNoInjection(pi, result)
  })

  it("#given every arming route #when dispatched #then none of them rewrites the user text", async () => {
    // given
    const armingPrompts = ["ulw do it", "/skill:frontend ulw polish", "Explain <ultrawork-mode> then ulw fix"] as const

    for (const prompt of armingPrompts) {
      const pi = new FakeExtensionAPI()
      await registerIsolatedUltrawork(pi)

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expect(result).toEqual({ action: "continue" })
      expect(pi.messages).toHaveLength(1)
    }
  })


  it("#given embedded directive #when inspected #then contains zero forbidden non-senpi tokens", () => {
    // then
    for (const token of FORBIDDEN_DIRECTIVE_TOKENS) {
      expect(SENPI_ULTRAWORK_DIRECTIVE.toLowerCase()).not.toContain(token.toLowerCase())
    }
  })

  it("#given embedded directive #when inspected #then keeps one machine marker", () => {
    // then
    expect(markerCount(SENPI_ULTRAWORK_DIRECTIVE)).toBe(1)
  })

  it("#given embedded directive #when inspected #then keeps the senpi-native tool contract", () => {
    // then: the senpi surface HAS goal/todo/task/team tools — the codex-derived
    // embed used to strip exactly these blocks out of the injected directive.
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("create_goal")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("`todo`")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("team_create")
  })

  it("#given generated directive #when embed script runs check #then passes without drift", () => {
    // given
    const command = ["node", "packages/omo-senpi/plugin/scripts/embed-directive.mjs", "--check"]

    // when
    const result = Bun.spawnSync({
      cmd: command,
      stdout: "pipe",
      stderr: "pipe",
    })

    // then
    expect(result.exitCode).toBe(0)
  })

  it("#given generated directive drift #when embed script runs check #then fails", () => {
    // given
    const original = readFileSync(generatedDirectivePath, "utf8")
    writeFileSync(generatedDirectivePath, `${original}\n`)

    try {
      // when
      const result = Bun.spawnSync({
        cmd: ["node", "packages/omo-senpi/plugin/scripts/embed-directive.mjs", "--check"],
        stdout: "pipe",
        stderr: "pipe",
      })

      // then
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain("generated directive drifted")
    } finally {
      writeFileSync(generatedDirectivePath, original)
    }
  })
})
