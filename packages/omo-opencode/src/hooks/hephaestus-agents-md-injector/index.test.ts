/// <reference types="bun-types" />

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createHephaestusAgentsMdInjectorHook } from "./index"

const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")
const SISYPHUS_DISPLAY = getAgentDisplayName("sisyphus")

let temporaryDirectory = ""

function createOutput(text = "Implement the thing") {
  return {
    message: {},
    parts: [{ type: "text", text }],
  }
}

describe("hephaestus agents md injector hook", () => {
  afterEach(() => {
    if (temporaryDirectory.length > 0) {
      rmSync(temporaryDirectory, { recursive: true, force: true })
      temporaryDirectory = ""
    }
  })

  test("injects project AGENTS.md into the first Hephaestus user message", async () => {
    // given
    temporaryDirectory = mkdtempSync(join(tmpdir(), "hephaestus-agents-md-"))
    writeFileSync(join(temporaryDirectory, "AGENTS.md"), "Always force-load this rule.")
    const hook = createHephaestusAgentsMdInjectorHook(unsafeTestValue({
      directory: temporaryDirectory,
      client: { session: { messages: async () => [] } },
    }))
    const output = createOutput()

    // when
    await hook["chat.message"]?.({
      sessionID: "ses_hep",
      agent: HEPHAESTUS_DISPLAY,
    }, output)

    // then
    expect(output.parts[0]?.text).toContain(`[Directory Context: ${realpathSync(join(temporaryDirectory, "AGENTS.md"))}]`)
    expect(output.parts[0]?.text).toContain("Always force-load this rule.")
    expect(output.parts[0]?.text).toEndWith("Implement the thing")
  })

  test("does not inject AGENTS.md for non-Hephaestus agents", async () => {
    // given
    temporaryDirectory = mkdtempSync(join(tmpdir(), "hephaestus-agents-md-"))
    writeFileSync(join(temporaryDirectory, "AGENTS.md"), "Hephaestus-only rule.")
    const hook = createHephaestusAgentsMdInjectorHook(unsafeTestValue({
      directory: temporaryDirectory,
      client: { session: { messages: async () => [] } },
    }))
    const output = createOutput()

    // when
    await hook["chat.message"]?.({
      sessionID: "ses_sis",
      agent: SISYPHUS_DISPLAY,
    }, output)

    // then
    expect(output.parts[0]?.text).toBe("Implement the thing")
  })

  test("does not inject when an earlier hook switched Hephaestus to another agent", async () => {
    // given
    temporaryDirectory = mkdtempSync(join(tmpdir(), "hephaestus-agents-md-"))
    writeFileSync(join(temporaryDirectory, "AGENTS.md"), "Should not be injected.")
    const hook = createHephaestusAgentsMdInjectorHook(unsafeTestValue({
      directory: temporaryDirectory,
      client: { session: { messages: async () => [] } },
    }))
    const output = createOutput()
    output.message.agent = "sisyphus"

    // when
    await hook["chat.message"]?.({
      sessionID: "ses_switched",
      agent: HEPHAESTUS_DISPLAY,
    }, output)

    // then
    expect(output.parts[0]?.text).toBe("Implement the thing")
  })

  test("injects AGENTS.md once per Hephaestus session", async () => {
    // given
    temporaryDirectory = mkdtempSync(join(tmpdir(), "hephaestus-agents-md-"))
    writeFileSync(join(temporaryDirectory, "AGENTS.md"), "Inject me once.")
    const hook = createHephaestusAgentsMdInjectorHook(unsafeTestValue({
      directory: temporaryDirectory,
      client: { session: { messages: async () => [] } },
    }))
    const firstOutput = createOutput("First")
    const secondOutput = createOutput("Second")

    // when
    await hook["chat.message"]?.({
      sessionID: "ses_once",
      agent: HEPHAESTUS_DISPLAY,
    }, firstOutput)
    await hook["chat.message"]?.({
      sessionID: "ses_once",
      agent: HEPHAESTUS_DISPLAY,
    }, secondOutput)

    // then
    expect(firstOutput.parts[0]?.text).toContain("Inject me once.")
    expect(secondOutput.parts[0]?.text).toBe("Second")
  })
})
