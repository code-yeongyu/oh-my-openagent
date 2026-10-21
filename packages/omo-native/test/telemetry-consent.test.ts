import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { PassThrough } from "node:stream"

import {
  TELEMETRY_CONSENT_PROMPT,
  consentStatePath,
  promptTelemetryConsentOnce,
  readTelemetryConsent,
  writeTelemetryConsent,
} from "../bin/lib/telemetry-consent.js"

const roots: string[] = []

function sandboxHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omo-pr-b-launcher-"))
  roots.push(home)
  return home
}

/** A readable with the TTY flag the launcher gates on, feeding one line and ending. */
function scriptedStdin(answer: string) {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean }
  stream.isTTY = true
  queueMicrotask(() => {
    stream.end(`${answer}\n`)
  })
  return stream
}

function recorder() {
  const lines: string[] = []
  const stream = {
    isTTY: true,
    write(chunk: string) {
      lines.push(chunk)
      return true
    },
  }
  return { ...stream, lines, stream: stream as unknown as NodeJS.WriteStream }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("launcher telemetry consent", () => {
  test("#given no answer yet #when the path is resolved #then it is the omo state file under the home directory", () => {
    const home = sandboxHome()
    expect(consentStatePath({ HOME: home })).toBe(join(home, ".omo", "state", "telemetry.json"))
  })

  test("#given the answer-file override #when the path is resolved #then the override wins", () => {
    expect(consentStatePath({ HOME: "/nope", OMO_TELEMETRY_CONSENT_FILE: "/tmp/elsewhere.json" })).toBe(
      "/tmp/elsewhere.json",
    )
  })

  test("#given no answer file #when it is read #then nobody has answered", () => {
    expect(readTelemetryConsent(join(sandboxHome(), ".omo", "state", "telemetry.json"))).toBeUndefined()
  })

  test("#given a first-run answer #when it is written #then the file is readable only by its owner", () => {
    const stateFilePath = join(sandboxHome(), ".omo", "state", "telemetry.json")

    expect(writeTelemetryConsent(stateFilePath, true)).toBe(true)
    expect(statSync(stateFilePath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(stateFilePath, "utf8")).enabled).toBe(true)
    expect(readTelemetryConsent(stateFilePath)).toBe(true)
  })

  test("#given a damaged answer file #when it is read #then nobody has answered", () => {
    const stateFilePath = join(sandboxHome(), ".omo", "state", "telemetry.json")
    mkdirSync(dirname(stateFilePath), { recursive: true })
    writeFileSync(stateFilePath, "{ not json")

    expect(readTelemetryConsent(stateFilePath)).toBeUndefined()
  })

  test("#given an interactive first run #when the user answers y #then the answer is stored as yes", async () => {
    const home = sandboxHome()
    const out = recorder()

    const asked = await promptTelemetryConsentOnce({
      env: { HOME: home },
      stderr: out.stream,
      stdin: scriptedStdin("y"),
    })

    expect(asked).toBe(true)
    expect(out.lines.join("")).toContain(TELEMETRY_CONSENT_PROMPT)
    expect(readTelemetryConsent(consentStatePath({ HOME: home }))).toBe(true)
  })

  test("#given an interactive first run #when the user answers nothing #then the answer is stored as no", async () => {
    const home = sandboxHome()

    await promptTelemetryConsentOnce({ env: { HOME: home }, stderr: recorder().stream, stdin: scriptedStdin("") })

    expect(readTelemetryConsent(consentStatePath({ HOME: home }))).toBe(false)
  })

  test("#given a machine that already answered #when omo starts again #then nobody is asked", async () => {
    const home = sandboxHome()
    writeTelemetryConsent(consentStatePath({ HOME: home }), true)
    const out = recorder()

    const asked = await promptTelemetryConsentOnce({ env: { HOME: home }, stderr: out.stream, stdin: scriptedStdin("n") })

    expect(asked).toBe(false)
    expect(out.lines.join("")).toBe("")
    expect(readTelemetryConsent(consentStatePath({ HOME: home }))).toBe(true)
  })

  test("#given a non-interactive launch #when the launcher starts #then nobody is asked", async () => {
    const home = sandboxHome()
    const stdin = scriptedStdin("y")
    ;(stdin as { isTTY: boolean }).isTTY = false

    const asked = await promptTelemetryConsentOnce({ env: { HOME: home }, stderr: recorder().stream, stdin })

    expect(asked).toBe(false)
    expect(readTelemetryConsent(consentStatePath({ HOME: home }))).toBeUndefined()
  })

  test("#given a machine that opted out in the environment #when the launcher starts #then nobody is asked", async () => {
    const home = sandboxHome()

    const asked = await promptTelemetryConsentOnce({
      env: { HOME: home, OMO_DISABLE_POSTHOG: "1" },
      stderr: recorder().stream,
      stdin: scriptedStdin("y"),
    })

    expect(asked).toBe(false)
    expect(readTelemetryConsent(consentStatePath({ HOME: home }))).toBeUndefined()
  })
})