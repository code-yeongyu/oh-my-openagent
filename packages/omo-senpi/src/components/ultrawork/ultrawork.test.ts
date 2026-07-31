/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createUltraworkComponent } from "./index"
import { FORBIDDEN_DIRECTIVE_TOKENS, SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

const generatedDirectivePath = resolve("packages/omo-senpi/src/components/ultrawork/generated-directive.ts")
const ULTRAWORK_CUSTOM_TYPE = "omo-ultrawork:directive"

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

async function dispatchInput(
  pi: FakeExtensionAPI,
  text: unknown,
  source: unknown = "interactive",
  streamingBehavior?: unknown,
): Promise<unknown> {
  const [result] = await pi.dispatch("input", {
    type: "input",
    text,
    source,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
  })
  return result
}

/** The directive must ride in as ONE hidden custom message, never as rewritten user text. */
function expectHiddenInjection(pi: FakeExtensionAPI, result: unknown, expectedDeliverAs?: "steer" | "followUp"): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(1)

  const [call] = pi.messages
  expect(call?.message["customType"]).toBe(ULTRAWORK_CUSTOM_TYPE)
  expect(call?.message["display"]).toBe(false)
  expect(call?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
  expect(call?.options?.["deliverAs"]).toBe(expectedDeliverAs)
}

function expectNoInjection(pi: FakeExtensionAPI, result: unknown): void {
  expect(result).toEqual({ action: "continue" })
  expect(pi.messages).toHaveLength(0)
}

/**
 * A prompt queued mid-stream must carry its directive INSIDE the same message.
 * Senpi drains steering and follow-up queues one message at a time by default, and
 * runs an assistant turn per drained message, so a separate hidden message would
 * burn its own turn before the user's ask ever arrives.
 */
function expectAtomicQueuedInjection(pi: FakeExtensionAPI, result: unknown, prompt: string): void {
  expect(result).toEqual({ action: "transform", text: `${prompt}\n${SENPI_ULTRAWORK_DIRECTIVE}` })
  expect(pi.messages).toHaveLength(0)
}

function markerCount(text: string): number {
  return text.match(/<ultrawork-mode>/g)?.length ?? 0
}

describe("omo-senpi ultrawork component", () => {
  it("#given trigger words #when user input dispatches #then arms via one hidden custom message", async () => {
    // given
    const prompts = ["please ultrawork this", "하이ulw", "refactor ulw_helper.ts"] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await createUltraworkComponent().register(pi, createTestContext(pi))

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectHiddenInjection(pi, result)
    }
  })

  it("#given a trigger word #when the user text is dispatched #then the typed text is never rewritten", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
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
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ulw ship it")

    // then
    expectHiddenInjection(pi, result, undefined)
    expect(pi.messages[0]?.options?.["deliverAs"]).toBeUndefined()
  })

  it("#given a steer-queued prompt #when a trigger arms #then the directive stays atomic with the prompt", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
    const prompt = "ulw redirect this"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "steer")

    // then
    expectAtomicQueuedInjection(pi, result, prompt)
  })

  it("#given a followUp-queued prompt #when a trigger arms #then the directive stays atomic with the prompt", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
    const prompt = "ulw queue this"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "followUp")

    // then: a hidden message here would be drained alone and answered on its own turn
    expectAtomicQueuedInjection(pi, result, prompt)
  })

  it("#given a queued /skill: command #when a trigger arms #then the directive is appended so expansion survives", async () => {
    // given: senpi expands /skill: only while the text still STARTS with the command
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
    const prompt = "/skill:frontend ulw 수준으로 다듬어줘"

    // when
    const result = await dispatchInput(pi, prompt, "interactive", "followUp")

    // then
    expectAtomicQueuedInjection(pi, result, prompt)
    expect((result as { text: string }).text.startsWith("/skill:frontend")).toBe(true)
  })

  it("#given any queued prompt #when a trigger arms #then no hidden message is emitted for it", async () => {
    // given: senpi queues ANY defined streamingBehavior, defaulting to steer
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ulw odd payload", "interactive", "bogus")

    // then
    expect(pi.messages).toHaveLength(0)
    expect(result).toMatchObject({ action: "transform" })
  })

  it("#given non-trigger input #when user input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "please explain this file")

    // then
    expectNoInjection(pi, result)
  })

  it("#given recursion guard source extension #when trigger input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ultrawork again", "extension")

    // then
    expectNoInjection(pi, result)
  })

  it("#given ultrawork disabled flag #when trigger input dispatches #then suppresses injection", async () => {
    // given
    const pi = new FakeExtensionAPI()
    pi.setFlag("omo-senpi-ultrawork-disabled", true)
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ulw fix this")

    // then
    expectNoInjection(pi, result)
  })

  it("#given malformed input #when input dispatches #then no-ops safely", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
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
      "omo ulw-loop status --json 확인",
    ] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await createUltraworkComponent().register(pi, createTestContext(pi))

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectNoInjection(pi, result)
    }
  })

  it("#given input already carrying an ultrawork block #when trigger word dispatches #then does not reinject", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
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
    await createUltraworkComponent().register(pi, createTestContext(pi))
    const prompt = "/skill:frontend ulw 수준으로 다듬어줘"

    // when
    const result = await dispatchInput(pi, prompt)

    // then
    expectHiddenInjection(pi, result)
  })

  it("#given a lone open-tag mention without a closing tag #when trigger word dispatches #then still injects", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
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
      await createUltraworkComponent().register(pi, createTestContext(pi))

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expectNoInjection(pi, result)
    }
  })

  it("#given /skill: command whose trigger appears only in the skill name #when dispatched #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))
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
      await createUltraworkComponent().register(pi, createTestContext(pi))

      // when
      const result = await dispatchInput(pi, prompt)

      // then
      expect(result).toEqual({ action: "continue" })
      expect(pi.messages).toHaveLength(1)
    }
  })

  it("#given synced senpi skill artifact #when description is read #then documents hidden injection instead of inviting a re-read", () => {
    // given
    const skillPath = resolve("packages/omo-senpi/plugin/skills/ultrawork/SKILL.md")
    const skillContent = readFileSync(skillPath, "utf8")
    const description = skillContent.match(/^description: (.*)$/m)?.[1] ?? ""

    // then
    expect(description).toContain("hidden")
    expect(description).toContain("do not read this file again")
    expect(description).not.toContain("injects the full directive inline")
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(description).not.toContain("short bootstrap")
    expect(description).not.toContain("Read the whole file")
  })


  it("#given embedded directive #when inspected #then contains zero forbidden non-senpi tokens", () => {
    // then
    for (const token of FORBIDDEN_DIRECTIVE_TOKENS) {
      expect(SENPI_ULTRAWORK_DIRECTIVE.toLowerCase()).not.toContain(token.toLowerCase())
    }
  })

  it("#given embedded directive #when inspected #then keeps required ultrawork anchors", () => {
    // then
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("ULTRAWORK MODE ENABLED!")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toMatch(/# Tier triage/i)
    expect(SENPI_ULTRAWORK_DIRECTIVE).toMatch(/Evidence-driven|captured evidence|evidence/i)
    expect(markerCount(SENPI_ULTRAWORK_DIRECTIVE)).toBe(1)
  })

  it("#given embedded directive #when inspected #then keeps the senpi-native tool contract", () => {
    // then: the senpi surface HAS goal/todo/task/team tools — the codex-derived
    // embed used to strip exactly these blocks out of the injected directive.
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("create_goal")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("`todo`")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("team_create")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("# Parallel execution")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("# Stop rules")
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
