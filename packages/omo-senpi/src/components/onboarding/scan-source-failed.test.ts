// #10983 (review L3): a setup source that throws reaches the onboarding RPC as `source_failed`, and
// its reason keeps only the failure kind, never the runtime's error text. The fault is real: a
// directory where the engine's models.json should be makes the provider stage's read throw.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OnboardingScanEvent } from "./scan-contract"
import { runOnboardingScan } from "./scan-runtime"

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
})
