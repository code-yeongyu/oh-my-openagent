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
    mode: "tui",
    hasUI: true,
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

  // While open_session is pending no RPC client can answer a dialog: senpi's RpcClient holds the session's events until
  // the open completes (#15213), and the senpi-task host client drops records whose routing id it does not know yet
  // (#15196). The confirm below therefore never settles, and session_start must settle without asking.
  for (const path of [
    { name: "a senpi RpcClient open (#15213)", env: {} },
    { name: "a senpi-task process child open (#15196)", env: { OMO_SENPI_TASK_RPC_CHILD: "1" } },
  ]) {
    it(`#given ${path.name} whose dialog is never answered #when session_start runs #then it settles without asking and records nothing`, async () => {
      const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-q-"))
      try {
        const env = {
          POSTHOG_API_KEY: "test-api-key",
          SENPI_CODING_AGENT_DIR: stateDir,
          HOME: stateDir,
          OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
          ...path.env,
        }
        const pi = new FakeExtensionAPI()
        createOmoNativeNoticeRegistration({ env, stateDir }).register(pi, {
          config: pi,
          logger: createSilentLogger(),
        })
        const asked = Promise.withResolvers<"asked">()
        const neverAnswered = {
          mode: "rpc",
          hasUI: true,
          ui: {
            confirm: () => {
              asked.resolve("asked")
              return new Promise<boolean>(() => {})
            },
          },
        }

        const outcome = await Promise.race([
          pi.dispatch("session_start", {}, neverAnswered).then(() => "settled" as const),
          asked.promise,
        ])

        expect(outcome).toBe("settled")
        expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
      } finally {
        rmSync(stateDir, { recursive: true, force: true })
      }
    })
  }

  it("#given a print session whose no-op UI declines every confirm #when it starts #then no decline is recorded", async () => {
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

      await pi.dispatch("session_start", {}, { ...askOnceUi(false, questions), mode: "print", hasUI: false })

      expect(questions).toEqual([])
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
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
      const env = {
        POSTHOG_API_KEY: "test-api-key",
        SENPI_CODING_AGENT_DIR: stateDir,
        HOME: stateDir,
        OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
      }
      const diagnostics: TelemetryDiagnosticInput[] = []
      const pi = new FakeExtensionAPI()
      createOmoNativeNoticeRegistration({
        env,
        stateDir,
        diagnostics: (input) => diagnostics.push(input),
      }).register(pi, { config: pi, logger: createSilentLogger() })

      await pi.dispatch(
        "session_start",
        {},
        {
          mode: "tui",
          hasUI: true,
          ui: {
            confirm: async () => {
              throw new Error("dialog crashed")
            },
          },
        },
      )

      expect(diagnostics).toHaveLength(1)
      expect(existsSync(consentMarkerPath(stateDir))).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
