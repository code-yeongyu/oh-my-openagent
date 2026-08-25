import { afterEach, describe, expect, test } from "bun:test"

import { collectCore, collectExternal } from "./entry-collector"
import {
  cleanupPalaceFixtures,
  createPalaceFixture,
  writePalaceWorkingFile,
} from "./palace.test-support"

afterEach(cleanupPalaceFixtures)

describe("palace entry collector", () => {
  test("#given a committed memory repo #when core entries are collected #then system files carry projection paths and bodies", async () => {
    const fixture = await createPalaceFixture()

    const core = await collectCore(fixture.repo, fixture.head)

    const persona = core.find((entry) => entry.path === "system/persona.md")
    expect(persona?.projection).toBe("$MEMORY_DIR/system/persona.md")
    expect(persona?.body).toContain("fixture persona")
    expect(persona?.description).toBe("who the agent is")
    expect(core.every((entry) => entry.path.startsWith("system/"))).toBe(true)
  }, 30_000)

  test("#given committed binary and text assets #when external entries are collected #then binaries report size only and never content", async () => {
    const fixture = await createPalaceFixture()

    const external = await collectExternal(fixture.repo, fixture.head)

    const binary = external.find((entry) => entry.path === "reference/logo.png")
    expect(binary?.binary).toBe(true)
    expect(binary?.byteSize).toBeGreaterThan(0)
    expect(binary?.body).toBeUndefined()
    const text = external.find((entry) => entry.path === "reference/notes.md")
    expect(text?.binary).toBe(false)
    expect(text?.body).toContain("external note")
  }, 30_000)

  test("#given a dirty working tree #when core entries are collected #then uncommitted files are labelled as absent from the system prompt", async () => {
    const fixture = await createPalaceFixture()
    await writePalaceWorkingFile(fixture, "system/draft.md", "---\ndescription: draft\n---\n\nnot committed yet\n")

    const core = await collectCore(fixture.repo, fixture.head)

    const draft = core.find((entry) => entry.path === "system/draft.md")
    expect(draft?.state).toBe("uncommitted - not active in system prompt")
    expect(core.find((entry) => entry.path === "system/persona.md")?.state).toBe("committed")
  }, 30_000)
})
