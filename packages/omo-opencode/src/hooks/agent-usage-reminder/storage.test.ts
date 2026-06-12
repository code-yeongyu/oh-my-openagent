import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AGENT_USAGE_REMINDER_STORAGE } from "./constants"
import { loadAgentUsageState } from "./storage"

describe("agent usage reminder storage catch fallbacks", () => {
  const sessionID = `catch-fallback-${crypto.randomUUID()}`
  const statePath = join(AGENT_USAGE_REMINDER_STORAGE, `${sessionID}.json`)

  afterEach(() => {
    rmSync(statePath, { force: true })
  })

  it("returns null when persisted state JSON is malformed", () => {
    // given
    mkdirSync(AGENT_USAGE_REMINDER_STORAGE, { recursive: true })
    writeFileSync(statePath, "{not-valid-json")

    // when
    const state = loadAgentUsageState(sessionID)

    // then
    expect(state).toBeNull()
  })
})
