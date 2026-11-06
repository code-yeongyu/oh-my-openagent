import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { getBuiltinSkillsRoot } from "../telemetry/product-identity"
import { createTempDirectories, encodeRecord, writeTranscript } from "./session-history/test-support"
import { createOnboardingSessionHistoryTool, ONBOARDING_SESSION_HISTORY_TOOL_NAME } from "./session-history-tool"
import { createOnboardingHarness } from "./test-harness"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")

async function fixture() {
  const claude = await temp.make("tui-claude-")
  const codex = await temp.make("tui-codex-")
  const workspace = await temp.make("tui-workspace-")
  const stateDir = await temp.make("tui-state-")
  await writeTranscript({ filePath: join(codex, "sessions", "2026", "08", "24", "rollout-one.jsonl"), mtimeMs: nowMs - 1_000, contents: [
    encodeRecord({ type: "session_meta", payload: { id: "codex-one", cwd: workspace } }),
    encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "Ship the onboarding feature" } }),
  ].join("\n") })
  const homes = [{ source: "claudeAgent" as const, homePath: claude }, { source: "codex" as const, homePath: codex }]
  return { homes, workspace, stateDir }
}

function laneThree(skill: string): string {
  const start = skill.indexOf("## 3. Session archaeology")
  const end = skill.indexOf("## 4. ", start)
  return skill.slice(start, end)
}

describe("onboarding session archaeology runs through the engine session-history module", () => {
  it("#given the onboarding component #when registered #then exposes the session-history tool", async () => {
    // given
    const dir = await temp.make("tui-onboarding-")

    // when
    const { pi } = createOnboardingHarness(dir)

    // then
    expect(pi.tools.map((tool) => tool.name)).toContain(ONBOARDING_SESSION_HISTORY_TOOL_NAME)
  })

  it("#given local agent history #when the tool runs #then returns the scan's projects and stored digests", async () => {
    // given
    const { homes, workspace, stateDir } = await fixture()
    const tool = createOnboardingSessionHistoryTool({ stateDir, newScanId: () => "tui-scan-1", scanOptions: { homes, omoSessionsRoots: [], now: () => nowMs } })

    // when
    const result = await tool.execute("call-1", {}, undefined, undefined, {} as never)

    // then
    expect(result.details).toEqual({
      scanId: "tui-scan-1",
      digestsFile: join(stateDir, "onboarding", "scans", "tui-scan-1", "digests.jsonl"),
      sources: { projects: { counts: { found: 1, read: 1, cap: 15_000 } }, sessions: { counts: { found: 1, read: 1, cap: 100 } } },
      projectCount: 1,
      digestCount: 1,
    })
    const stored = (await readFile(result.details.digestsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    expect(stored).toEqual([expect.objectContaining({ sessionKey: "codex:codex-one", cwd: workspace, firstRequest: "Ship the onboarding feature" })])
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("")
    expect(text).toContain(`- ${workspace} [codex] threads=1`)
    expect(text).toContain(JSON.stringify(stored[0]))
  })

  // Tool-name contract: the runtime dispatches on the name lane 3 tells the agent to call.
  it("#given the onboarding skill #when lane 3 names its tools #then each one is registered by the onboarding component", async () => {
    // given
    const skill = await readFile(join(getBuiltinSkillsRoot(), "onboarding", "SKILL.md"), "utf8")
    const { pi } = createOnboardingHarness(await temp.make("tui-onboarding-"))
    const registered = new Set(pi.tools.map((tool) => tool.name))

    // when
    const named = [...laneThree(skill).matchAll(/`(onboarding_[a-z_]+)`/g)].map((match) => match[1])

    // then
    expect(named).toContain(ONBOARDING_SESSION_HISTORY_TOOL_NAME)
    expect(named.filter((name) => !registered.has(name))).toEqual([])
  })
})
