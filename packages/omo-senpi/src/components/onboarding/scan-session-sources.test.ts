import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import type { OnboardingScanEvent } from "./scan-contract"
import { runOnboardingScan } from "./scan-runtime"
import { getOmoNativeStateDir } from "../telemetry/product-identity"
import { createTempDirectories, encodeRecord, writeTranscript } from "./session-history/test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

async function fixture() {
  const home = await temp.make("onboarding-sources-home-")
  const codex = await temp.make("onboarding-sources-codex-")
  const claude = await temp.make("onboarding-sources-claude-")
  const workspace = await temp.make("onboarding-sources-workspace-")
  const stateDir = await temp.make("onboarding-sources-state-")
  for (const [index, prompt] of ["Ship the feature", "Fix the flaky test"].entries()) {
    await writeTranscript({
      filePath: join(codex, "sessions", "2026", "10", "18", `rollout-${index}.jsonl`),
      mtimeMs: Date.now() - (index + 1) * 1_000,
      contents: [
        encodeRecord({ type: "session_meta", payload: { id: `codex-${index}`, cwd: workspace } }),
        encodeRecord({ type: "event_msg", payload: { type: "user_message", message: prompt } }),
      ].join("\n"),
    })
  }
  return {
    workspace,
    stateDir,
    environment: {
      home,
      env: { HOME: home },
      agentDir: join(home, ".omo", "agent"),
      stateDir,
      sessionHistory: {
        homes: [{ source: "claudeAgent" as const, homePath: claude }, { source: "codex" as const, homePath: codex }],
        omoSessionsRoots: [],
      },
    },
  }
}

describe("onboarding scan projects and sessions sources (#10478 + #10479)", () => {
  it("#given two recent sessions in one project #when the onboarding scan runs #then projects and sessions stream with the 5000 cap", async () => {
    // given
    const { workspace, environment } = await fixture()
    const events: OnboardingScanEvent[] = []

    // when
    await runOnboardingScan(environment, { scanId: "scan-sources", includeCustomProviders: false }, (event) => events.push(event))

    // then
    const own = (source: string) => events.filter((event) => event.source === source).map((event) => event.kind)
    expect(own("projects")).toEqual(["source_started", "item", "source_done"])
    expect(own("sessions")).toEqual(["source_started", "item", "item", "source_done"])
    expect(events.find((event) => event.source === "projects" && event.kind === "item")?.item).toMatchObject({ id: workspace, kind: "project", state: "found" })
    const sessionItems = events.filter((event) => event.source === "sessions" && event.kind === "item").map((event) => event.item)
    expect(sessionItems).toEqual([
      { id: "codex:codex-0", kind: "session", state: "found", detail: "Ship the feature", project: workspace },
      { id: "codex:codex-1", kind: "session", state: "found", detail: "Fix the flaky test", project: workspace },
    ])
    expect(events.find((event) => event.source === "projects" && event.kind === "source_done")?.counts).toEqual({ found: 2, read: 2, cap: 5_000 })
    expect(events.find((event) => event.source === "sessions" && event.kind === "source_done")?.counts).toEqual({ found: 2, read: 2, cap: 5_000 })
    const done = events.at(-1)
    expect(done?.kind).toBe("done")
    expect(events.findIndex((event) => event.source === "sessions")).toBeGreaterThan(events.findIndex((event) => event.source === "projects"))
  })

  it("#given a finished scan #when nobody has consented yet #then its digests are held in memory and nothing is written to disk", async () => {
    // given
    const { stateDir, environment } = await fixture()

    // when
    const outcome = await runOnboardingScan(environment, { scanId: "scan-digests", includeCustomProviders: false }, () => undefined)

    // then
    expect(outcome.digests.map((digest) => digest.firstRequest)).toEqual(["Ship the feature", "Fix the flaky test"])
    expect(existsSync(join(stateDir, "onboarding", "scans"))).toBe(false)
    expect(existsSync(join(getOmoNativeStateDir(environment.env), "onboarding", "scans"))).toBe(false)
  })
})
