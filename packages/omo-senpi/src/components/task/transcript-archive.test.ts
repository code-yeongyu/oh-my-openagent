import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import {
  TASK_TRANSCRIPT_ARCHIVE_DIR_NAME,
  resolveRuntimeAgentHome,
  resolveTranscriptArchiveDir,
} from "./transcript-archive"

function settings(transcriptRetention: Record<string, unknown> | undefined) {
  return OmoTaskSettingsSchema.parse(
    transcriptRetention === undefined ? {} : { transcript_retention: transcriptRetention },
  )
}

describe("resolveTranscriptArchiveDir", () => {
  test("#given retention disabled or absent #when resolving #then no archive dir is produced", () => {
    expect(resolveTranscriptArchiveDir(settings(undefined), {})).toBeUndefined()
    expect(resolveTranscriptArchiveDir(settings({ enabled: false }), {})).toBeUndefined()
  })

  test("#given retention enabled #when resolving #then the archive dir sits under the agent home sessions tree with a finder-scannable name", () => {
    const dir = resolveTranscriptArchiveDir(settings({ enabled: true }), { SENPI_CODING_AGENT_DIR: "/agent/home" })
    expect(dir).toBe("/agent/home/sessions/--omo-senpi-task-archive--")
    // The existing Senpi session finder only scans project directories named --<name>--.
    expect(TASK_TRANSCRIPT_ARCHIVE_DIR_NAME).toMatch(/^--.+--$/)
  })

  test("#given retention enabled #when resolving #then the archive dir sits under the resolved agent home sessions tree", () => {
    const dir = resolveTranscriptArchiveDir(settings({ enabled: true }), {})
    expect(dir?.endsWith("/sessions/--omo-senpi-task-archive--")).toBe(true)
    expect(dir?.startsWith("/")).toBe(true)
  })
})

describe("resolveRuntimeAgentHome", () => {
  test("#given SENPI_CODING_AGENT_DIR set #when resolving #then it wins over a stale OMO_ variable so sandbox archives cannot leak into a real agent dir", () => {
    const home = resolveRuntimeAgentHome({ SENPI_CODING_AGENT_DIR: "/sandbox/agent", OMO_CODING_AGENT_DIR: "/real/agent" })
    expect(home).toBe(resolve("/sandbox/agent"))
  })

  test("#given only OMO_CODING_AGENT_DIR set #when resolving #then the omo location is used (real-install launcher pins both to the same dir)", () => {
    expect(resolveRuntimeAgentHome({ OMO_CODING_AGENT_DIR: "/real/agent" })).toBe(resolve("/real/agent"))
  })

  test("#given blank SENPI_CODING_AGENT_DIR #when resolving #then it is ignored", () => {
    expect(resolveRuntimeAgentHome({ SENPI_CODING_AGENT_DIR: "   ", OMO_CODING_AGENT_DIR: "/real/agent" })).toBe(resolve("/real/agent"))
  })
})
