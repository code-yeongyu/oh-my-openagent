import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import { getOmoNativeStateDir } from "./product-identity"
import { automatedRunReason, isOmoNativeTelemetryEnabled } from "./omo-native-session"
import { isOmoNativeConsentAccepted, readOmoNativeConsent, recordOmoNativeConsent } from "./omo-native-consent"
import { createEnabledEnv, withTempAgentDir } from "./telemetry.test-support"

describe("omo-native consent marker", () => {
  it("#given a recorded accept #when read back #then the answer survives as accepted", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-"))
    try {
      expect(recordOmoNativeConsent(stateDir, "accepted")).toBe(true)
      expect(readOmoNativeConsent(stateDir)).toBe("accepted")
      expect(isOmoNativeConsentAccepted(stateDir)).toBe(true)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given a recorded decline #when read back #then telemetry is not consented", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-"))
    try {
      expect(recordOmoNativeConsent(stateDir, "declined")).toBe(true)
      expect(readOmoNativeConsent(stateDir)).toBe("declined")
      expect(isOmoNativeConsentAccepted(stateDir)).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given no marker #when consent is read #then nothing is consented", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-"))
    try {
      expect(readOmoNativeConsent(stateDir)).toBeUndefined()
      expect(isOmoNativeConsentAccepted(stateDir)).toBe(false)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given a corrupt or future-version marker #when read #then nothing is consented", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-"))
    try {
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "consent-answer"), "{not json")
      expect(readOmoNativeConsent(stateDir)).toBeUndefined()
      writeFileSync(join(stateDir, "consent-answer"), '{"v":99,"answer":"accepted"}')
      expect(readOmoNativeConsent(stateDir)).toBeUndefined()
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it("#given an existing answer #when another answer is recorded #then the first answer wins", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-consent-"))
    try {
      expect(recordOmoNativeConsent(stateDir, "declined")).toBe(true)
      expect(recordOmoNativeConsent(stateDir, "accepted")).toBe(false)
      expect(readOmoNativeConsent(stateDir)).toBe("declined")
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})

describe("omo-native telemetry consent gate (#14920 wave B)", () => {
  function unansweredEnv(agentDir: string) {
    return {
      POSTHOG_API_KEY: "test-api-key",
      SENPI_CODING_AGENT_DIR: agentDir,
      HOME: agentDir,
      USERPROFILE: agentDir,
      OMO_TELEMETRY_ALLOW_AUTOMATION: "1",
    }
  }

  it("#given env and config enabled but no consent answer #when the enablement gate is read #then telemetry is off", async () => {
    await withTempAgentDir(async (agentDir) => {
      const env = unansweredEnv(agentDir)
      expect(isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true }, {}, env)).toBe(false)
    })
  })

  it("#given an accepted consent marker #when the enablement gate is read #then telemetry is on", async () => {
    await withTempAgentDir(async (agentDir) => {
      const env = unansweredEnv(agentDir)
      recordOmoNativeConsent(getOmoNativeStateDir(env), "accepted")
      expect(isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true }, {}, env)).toBe(true)
    })
  })

  it("#given a declined consent marker #when the enablement gate is read #then telemetry is off", async () => {
    await withTempAgentDir(async (agentDir) => {
      const env = unansweredEnv(agentDir)
      recordOmoNativeConsent(getOmoNativeStateDir(env), "declined")
      expect(isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true }, {}, env)).toBe(false)
    })
  })
})
