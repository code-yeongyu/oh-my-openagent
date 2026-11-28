// #10983 (review L3): a setup source that throws reaches the onboarding RPC as `source_failed`, and
// its reason keeps only the failure kind, never the runtime's error text. The fault is real: a
// directory where the engine's models.json should be makes the provider stage's read throw.
// #15352: the kind carries no path, and the session-history sources use the same vocabulary.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { OnboardingScanEvent } from "./scan-contract"
import { onboardingScanContext, runOnboardingScan } from "./scan-runtime"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("onboarding scan source failure", () => {
  test("#given a source whose read throws #when the scan runs #then source_failed carries the failure kind only", async () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-scan-source-failed-"))
    roots.push(home)
    const agentDir = join(home, ".omo", "agent")
    mkdirSync(join(agentDir, "models.json"), { recursive: true })
    const events: OnboardingScanEvent[] = []

    // when
    await runOnboardingScan(
      { home, env: { HOME: home }, agentDir },
      { scanId: "scan-source-failed", includeCustomProviders: true, sessions: false },
      (event) => events.push(event),
    )

    // then
    const failed = events.filter((event) => event.kind === "source_failed")
    expect(failed.map((event) => event.source)).toEqual(["providers"])
    expect(failed.map((event) => event.reason)).toEqual(["EISDIR"])
  })

  test("#given history sources failing with a parser error that quotes a malformed credential file #when the scan runs #then no RPC row and no first-prompt line repeats the file's bytes", async () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-scan-history-failed-"))
    roots.push(home)
    const token = "sk_test_SYNTHETIC_history_15352"
    const credentials = join(home, ".codex", "auth.json")
    mkdirSync(dirname(credentials), { recursive: true })
    // A bare value: the "unexpected token" shape the runtime's parser names in its message.
    writeFileSync(credentials, `{"OPENAI_API_KEY":${token}}`)
    let parserError: unknown
    try {
      JSON.parse(readFileSync(credentials, "utf8"))
    } catch (error) {
      parserError = error
    }
    expect(String(parserError)).toContain(token)
    const events: OnboardingScanEvent[] = []

    // when: the history readers guard every filesystem call, so the fault enters through the
    // scanner's clock, which both history sources read and neither guards
    await runOnboardingScan(
      {
        home,
        env: { HOME: home },
        agentDir: join(home, ".omo", "agent"),
        sessionHistory: {
          homes: [],
          omoSessionsRoots: [],
          now: () => {
            throw parserError
          },
        },
      },
      { scanId: "scan-history-failed", includeCustomProviders: false },
      (event) => events.push(event),
    )

    // then
    const failed = events.filter((event) => event.kind === "source_failed")
    expect(failed.map((event) => [event.source, event.reason])).toEqual([
      ["projects", "not valid JSON"],
      ["sessions", "not valid JSON"],
    ])
    expect(JSON.stringify(events)).not.toContain(token)
    expect(onboardingScanContext("scan-history-failed", events)).not.toContain(token)
  })
})
