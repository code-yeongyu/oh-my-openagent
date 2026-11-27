import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { recordOmoNativeConsent, type OmoNativeConsentAnswer } from "../telemetry/omo-native-consent"
import { getOmoNativeStateDir } from "../telemetry/product-identity"
import { collectHostSections } from "./collect-host"

let root: string
let previousAgentDir: string | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-feedback-consent-"))
  previousAgentDir = process.env.OMO_CODING_AGENT_DIR
  process.env.OMO_CODING_AGENT_DIR = join(root, "agent")
})
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = previousAgentDir
  rmSync(root, { recursive: true, force: true })
})

const installId = "a".repeat(64)
const installHash = createHash("sha256").update(installId).digest("hex")
function fixtureEnv(env: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    HOME: root,
    USERPROFILE: root,
    OMO_CODING_AGENT_DIR: join(root, "agent"),
    OMO_NATIVE_INSTALL_ID: installId,
    ...env,
  }
}
// #14920 wave B: hashes need a recorded first-run answer of `accepted`; each case starts from fresh state (first write wins).
function answer(consent: OmoNativeConsentAnswer, env: Readonly<Record<string, string>> = {}): void {
  expect(recordOmoNativeConsent(getOmoNativeStateDir(fixtureEnv(env)), consent)).toBe(true)
}
function collect(env: Readonly<Record<string, string>> = {}) {
  return collectHostSections({
    env: fixtureEnv(env),
    omoVersion: "synthetic",
    senpiVersion: "synthetic",
    channel: "test",
    now: new Date("2026-10-26T00:00:00.000Z"),
    session: { sessionId: "synthetic-session", entries: [] },
  })
}

const gates: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ["CI", { CI: "1" }],
  ["NODE_ENV", { NODE_ENV: "test" }],
  ["VITEST", { VITEST: "1" }],
  ["JEST_WORKER_ID", { JEST_WORKER_ID: "1" }],
  ["ephemeral HOME", {}],
  ["adapter disable", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1", OMO_SENPI_DISABLE_POSTHOG: "1" }],
  ["adapter send opt-out", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1", OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" }],
  ["feedback disable", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1", OMO_NATIVE_DISABLE_POSTHOG: "1" }],
  ["global opt-out", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1", DO_NOT_TRACK: "1" }],
]
test.each(gates)(
  "#given %s suppresses telemetry #when feedback is collected #then hashes are absent and ordinary sections remain",
  (_name, env) => {
    answer("accepted", env)
    const result = collect(env)
    expect(result.installHash).toBeUndefined()
    expect(result.sessionHash).toBeUndefined()
    expect(result.sections.find((section) => section.id === "identity")?.text).not.toContain(installHash)
    expect(result.sections.map((section) => section.id)).toEqual(["identity", "environment", "config", "session"])
    expect(existsSync(join(root, "agent", "omo-senpi", "omo-native", "session-id-salt"))).toBe(false)
  },
)

test("#given a deliberate automation opt-in #when feedback is collected #then allowed hashes remain available", () => {
  answer("accepted", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1" })
  const result = collect({ OMO_TELEMETRY_ALLOW_AUTOMATION: "1" })
  expect(result.installHash).toBe(installHash)
  expect(result.sessionHash).toMatch(/^[0-9a-f]{64}$/)
  expect(result.sections.find((section) => section.id === "identity")?.text).toContain(installHash)
})

test("#given configuration disables telemetry #when automation is opted in #then feedback still omits hashes", () => {
  mkdirSync(join(root, ".omo"))
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({ telemetry: { enabled: false } }))
  answer("accepted", { OMO_TELEMETRY_ALLOW_AUTOMATION: "1" })
  const result = collect({ OMO_TELEMETRY_ALLOW_AUTOMATION: "1" })
  expect(result.installHash).toBeUndefined()
  expect(result.sessionHash).toBeUndefined()
})

const unconsented: ReadonlyArray<readonly [string, OmoNativeConsentAnswer | undefined]> = [
  ["unanswered", undefined],
  ["declined", "declined"],
]
test.each(unconsented)(
  "#given the first-run consent is %s #when automation is allowed and feedback is collected #then no hash is sent or salted and ordinary sections remain",
  (_name, consent) => {
    const env = { OMO_TELEMETRY_ALLOW_AUTOMATION: "1" }
    if (consent !== undefined) answer(consent, env)
    const result = collect(env)
    expect(result.installHash).toBeUndefined()
    expect(result.sessionHash).toBeUndefined()
    expect(result.sections.find((section) => section.id === "identity")?.text).not.toContain(installHash)
    expect(result.sections.map((section) => section.id)).toEqual(["identity", "environment", "config", "session"])
    expect(existsSync(join(root, "agent", "omo-senpi", "omo-native", "session-id-salt"))).toBe(false)
  },
)
