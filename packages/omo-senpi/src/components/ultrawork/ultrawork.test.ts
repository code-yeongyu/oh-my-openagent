/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createUltraworkComponent } from "./index"
import { FORBIDDEN_DIRECTIVE_TOKENS, SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

const evidenceRoot = resolve(".omo/evidence/omo-senpi-adapter/task-4")
const generatedDirectivePath = resolve("packages/omo-senpi/src/components/ultrawork/generated-directive.ts")

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

async function dispatchInput(pi: FakeExtensionAPI, text: unknown, source: unknown = "interactive"): Promise<unknown> {
  const [result] = await pi.dispatch("input", {
    type: "input",
    text,
    source,
  })
  return result
}

function getTransformedText(result: unknown): string {
  expect(result).toMatchObject({ action: "transform" })
  if (typeof result !== "object" || result === null || !("text" in result)) {
    throw new Error("expected transform result with text")
  }
  const text = result.text
  if (typeof text !== "string") {
    throw new Error("expected transformed text to be a string")
  }
  return text
}

function markerCount(text: string): number {
  return text.match(/<ultrawork-mode>/g)?.length ?? 0
}

describe("omo-senpi ultrawork component", () => {
  it("#given trigger words #when user input dispatches #then injects exactly one ultrawork block", async () => {
    // given
    const prompts = ["please ultrawork this", "하이ulw", "refactor ulw_helper.ts"] as const

    for (const prompt of prompts) {
      const pi = new FakeExtensionAPI()
      await createUltraworkComponent().register(pi, createTestContext(pi))

      // when
      const result = await dispatchInput(pi, prompt)
      const transformed = getTransformedText(result)

      // then
      expect(markerCount(transformed)).toBe(1)
      expect(transformed).toContain("<ultrawork-mode>")
      expect(transformed).toContain("ULTRAWORK MODE ENABLED!")
      expect(transformed).toContain(prompt)
    }
  })

  it("#given non-trigger input #when user input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "please explain this file")

    // then
    expect(result).toEqual({ action: "continue" })
  })

  it("#given recursion guard source extension #when trigger input dispatches #then injects nothing", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ultrawork again", "extension")

    // then
    expect(result).toEqual({ action: "continue" })
  })

  it("#given ultrawork disabled flag #when trigger input dispatches #then suppresses injection", async () => {
    // given
    const pi = new FakeExtensionAPI()
    pi.setFlag("omo-senpi-ultrawork-disabled", true)
    await createUltraworkComponent().register(pi, createTestContext(pi))

    // when
    const result = await dispatchInput(pi, "ulw fix this")

    // then
    expect(result).toEqual({ action: "continue" })
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
  })

  it("#given embedded directive #when inspected #then contains zero forbidden Codex tokens", () => {
    // then
    for (const token of FORBIDDEN_DIRECTIVE_TOKENS) {
      expect(SENPI_ULTRAWORK_DIRECTIVE.toLowerCase()).not.toContain(token.toLowerCase())
    }
    expect(SENPI_ULTRAWORK_DIRECTIVE).not.toMatch(/browser:control-in-app-browser|Codex Browser plugin/i)
  })

  it("#given embedded directive #when inspected #then keeps required ultrawork anchors", () => {
    // then
    expect(SENPI_ULTRAWORK_DIRECTIVE).toContain("ULTRAWORK MODE ENABLED!")
    expect(SENPI_ULTRAWORK_DIRECTIVE).toMatch(/# Tier triage/i)
    expect(SENPI_ULTRAWORK_DIRECTIVE).toMatch(/Evidence-driven|captured evidence|evidence/i)
    expect(markerCount(SENPI_ULTRAWORK_DIRECTIVE)).toBe(1)
  })

  it("#given generated directive #when embed script runs check #then passes without drift", () => {
    // given
    expect(existsSync(evidenceRoot)).toBe(true)

    // when
    const result = Bun.spawnSync({
      cmd: ["node", "packages/omo-senpi/plugin/scripts/embed-directive.mjs", "--check"],
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
