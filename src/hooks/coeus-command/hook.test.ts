import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { findBriefBySlug, findLatestBrief, listBriefs } from "./brief-detector"
import { buildCoeusContext, type CoeusSessionState } from "./state-injector"
import { createCoeusCommandHook } from "./hook"
import { COEUS_SESSION_TAG } from "./constants"

const TEST_DIR = join(tmpdir(), `coeus-command-test-${Date.now()}`)
const BRIEFS_DIR = join(TEST_DIR, ".sisyphus", "briefs")
const PLANS_DIR = join(TEST_DIR, ".sisyphus", "plans")

beforeEach(() => {
  mkdirSync(BRIEFS_DIR, { recursive: true })
  mkdirSync(PLANS_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
})

describe("brief-detector", () => {
  //#given an empty briefs directory
  //#when findBriefBySlug is called
  //#then it returns null
  it("findBriefBySlug returns null for empty dir", () => {
    const result = findBriefBySlug(TEST_DIR, "my-project")
    expect(result).toBeNull()
  })

  //#given a brief file matching the slug
  //#when findBriefBySlug is called with that slug
  //#then it returns the file path
  it("findBriefBySlug returns path when brief matches slug", () => {
    const briefPath = join(BRIEFS_DIR, "my-project-20260305.md")
    writeFileSync(briefPath, "# Brief")
    const result = findBriefBySlug(TEST_DIR, "my-project")
    expect(result).toBe(briefPath)
  })

  //#given multiple brief files
  //#when findLatestBrief is called
  //#then it returns the most recently named one
  it("findLatestBrief returns most recent brief", () => {
    writeFileSync(join(BRIEFS_DIR, "proj-20260301.md"), "old")
    writeFileSync(join(BRIEFS_DIR, "proj-20260305.md"), "new")
    const result = findLatestBrief(TEST_DIR)
    expect(result).toContain("proj-20260305.md")
  })

  //#given an empty briefs directory
  //#when findLatestBrief is called
  //#then it returns null
  it("findLatestBrief returns null for empty dir", () => {
    const result = findLatestBrief(TEST_DIR)
    expect(result).toBeNull()
  })

  //#given brief files exist
  //#when listBriefs is called
  //#then it returns all .md file paths
  it("listBriefs returns all brief paths", () => {
    writeFileSync(join(BRIEFS_DIR, "a-20260301.md"), "a")
    writeFileSync(join(BRIEFS_DIR, "b-20260302.md"), "b")
    const result = listBriefs(TEST_DIR)
    expect(result).toHaveLength(2)
  })
})

describe("state-injector", () => {
  //#given state is "fresh"
  //#when buildCoeusContext is called
  //#then it returns interview instruction text
  it('buildCoeusContext("fresh") returns interview instruction', () => {
    const result = buildCoeusContext("fresh")
    expect(result).toContain("interview")
    expect(result).toContain(".sisyphus/briefs/")
  })

  //#given state is "brief-exists" with a path
  //#when buildCoeusContext is called
  //#then it references the brief path and skips interview
  it('buildCoeusContext("brief-exists") references brief path', () => {
    const result = buildCoeusContext("brief-exists", "/path/to/brief.md")
    expect(result).toContain("/path/to/brief.md")
    expect(result).toContain("Skip interview")
  })

  //#given state is "plan-exists"
  //#when buildCoeusContext is called
  //#then it tells user to use /start-work
  it('buildCoeusContext("plan-exists") suggests /start-work', () => {
    const result = buildCoeusContext("plan-exists")
    expect(result).toContain("/start-work")
  })
})

describe("createCoeusCommandHook", () => {
  const makeParts = (text: string) => [{ type: "text", text }]

  //#given a message without <coeus-session>
  //#when the hook runs
  //#then it does not modify output
  it("does nothing when coeus-session tag absent", async () => {
    const hook = createCoeusCommandHook({ directory: TEST_DIR } as any)
    const output = { message: {}, parts: makeParts("hello world") }
    await hook["chat.message"]({ sessionID: "s1" }, output)
    expect(output.parts[0].text).toBe("hello world")
  })

  //#given a message with <coeus-session> and no briefs
  //#when the hook runs
  //#then it injects "fresh" context (interview instruction)
  it("injects fresh context when no brief exists", async () => {
    const hook = createCoeusCommandHook({ directory: TEST_DIR } as any)
    const msg = `${COEUS_SESSION_TAG}\n<user-request slug="my-proj">do stuff</user-request>`
    const output = { message: {}, parts: makeParts(msg) }
    await hook["chat.message"]({ sessionID: "s2" }, output)
    expect(output.parts[0].text).toContain("interview")
  })

  //#given a message with <coeus-session> and a matching brief exists
  //#when the hook runs
  //#then it injects "brief-exists" context
  it("injects brief-exists context when brief found", async () => {
    writeFileSync(join(BRIEFS_DIR, "my-proj-20260305.md"), "# Brief content")
    const hook = createCoeusCommandHook({ directory: TEST_DIR } as any)
    const msg = `${COEUS_SESSION_TAG}\n<user-request slug="my-proj">do stuff</user-request>`
    const output = { message: {}, parts: makeParts(msg) }
    await hook["chat.message"]({ sessionID: "s3" }, output)
    expect(output.parts[0].text).toContain("Brief found")
    expect(output.parts[0].text).toContain("Skip interview")
  })
})
