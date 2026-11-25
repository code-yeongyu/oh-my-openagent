import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import { UNCONFIGURED_POSTHOG_API_KEY, type TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeNoticeRegistration } from "./omo-native-notice"
import { getOmoNativeStateDir } from "./product-identity"
import { readOmoNativeConsent } from "./omo-native-consent"
import { createEnabledEnv, createSilentLogger, withTempAgentDir } from "./telemetry.test-support"

function register(
  agentDir: string,
  options: {
    readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
    readonly env?: Record<string, string | undefined>
    readonly stateDir?: string
  } = {},
): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  createOmoNativeNoticeRegistration({
    diagnostics: options.diagnostics,
    env: options.env ?? createEnabledEnv(agentDir),
    stateDir: options.stateDir,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  return pi
}

type Question = { readonly title: string; readonly message: string }

function askOnceUi(answer: boolean | Promise<boolean>, questions: Question[]) {
  return {
    ui: {
      confirm: async (title: string, message: string) => {
        questions.push({ title, message })
        return answer
      },
    },
  }
}

function consentMarkerPath(stateDir: string): string {
  return join(stateDir, "consent-answer")
}

describe("OmO Native telemetry consent question", () => {
  it("#given telemetry registration #when commands are inspected #then no telemetry audit command is exposed", async () => {
    await withTempAgentDir(async (agentDir) => {
      const pi = register(agentDir)

      const commandNames = pi.commands.map(({ name }) => name)

      expect(commandNames).not.toContain("omo-telemetry")
    })
  })

  it("#given no recorded answer #when a session starts with a confirm dialog #then the question is asked once and the answer is recorded", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
    try {
      const env = {
        POSTHOG_API_KEY: "test-api-key",
        SENPI_CODING_AGENT_DIR: stateDir,
        HOME: stateDir,
        OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
      }
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
        config: pi,
        logger: createSilentLogger(),
      })
      const questions: Question[] = []
      const ctx = askOnceUi(true, questions)

      await pi.dispatch("session_start", {}, ctx)
      await pi.dispatch("session_start", {}, ctx)

      expect(questions).toHaveLength(1)
      expect(questions[0]?.title).toBe("Anonymous telemetry")
      expect(questions[0]?.message).toContain("https://t.omo.dev")
      expect(readOmoNativeConsent(stateDir)).toBe("accepted")
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given a refusal #when the question is answered #then the decline is recorded and nothing is re-asked", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
    try {
      const env = { POSTHOG_API_KEY: "test-api-key", SENPI_CODING_AGENT_DIR: stateDir, HOME: stateDir, OMO_TELEMETRY_ALLOW_AUTOMATION: "1" }
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
        config: pi,
        logger: createSilentLogger(),
      })
      const questions: Question[] = []

      await pi.dispatch("session_start", {}, askOnceUi(false, questions))
      await pi.dispatch("session_start", {}, askOnceUi(true, questions))

      expect(questions).toHaveLength(1)
      expect(readOmoNativeConsent(stateDir)).toBe("declined")
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given no confirm dialog #when a session starts #then nothing is asked and nothing is recorded", async () => {
    await withTempAgentDir(async (agentDir) => {
      const env = { ...createEnabledEnv(agentDir) }
      // The enabled env seeds a recorded accept; remove it so the machine is unanswered.
      const stateDir = getOmoNativeStateDir(env)
      rmSync(consentMarkerPath(stateDir), { force: true })
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
        config: pi,
        logger: createSilentLogger(),
      })
      const notifications: string[] = []

      await pi.dispatch("session_start", {}, { ui: { notify: (message: string) => notifications.push(message) } })

      expect(notifications).toEqual([])
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    })
  })

  it("#given DO_NOT_TRACK=1 #when a session starts #then no question is asked", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
    try {
      const env = {
        POSTHOG_API_KEY: "test-api-key",
        SENPI_CODING_AGENT_DIR: stateDir,
        HOME: stateDir,
        OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
        DO_NOT_TRACK: "1",
      }
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
        config: pi,
        logger: createSilentLogger(),
      })
      const questions: Question[] = []

      await pi.dispatch("session_start", {}, askOnceUi(true, questions))

      expect(questions).toEqual([])
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given the unconfigured project key #when a session starts #then no question is asked", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
    try {
      const env = {
        POSTHOG_API_KEY: UNCONFIGURED_POSTHOG_API_KEY,
        SENPI_CODING_AGENT_DIR: stateDir,
        HOME: stateDir,
        OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
      }
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
        config: pi,
        logger: createSilentLogger(),
      })
      const questions: Question[] = []

      await pi.dispatch("session_start", {}, askOnceUi(true, questions))

      expect(questions).toEqual([])
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given a throwing dialog #when the question fails #then one diagnostic is reported and no answer is recorded", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
    try {
      const env = { POSTHOG_API_KEY: "test-api-key", SENPI_CODING_AGENT_DIR: stateDir, HOME: stateDir, OMO_TELEMETRY_ALLOW_AUTOMATION: "1" }
      const diagnostics: TelemetryDiagnosticInput[] = []
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({
        env,
        stateDir,
        diagnostics: (input) => diagnostics.push(input),
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch("session_start", {}, {
        ui: {
          confirm: async () => {
            throw new Error("dialog crashed")
          },
        },
      })

      expect(diagnostics).toHaveLength(1)
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
