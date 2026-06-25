import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import yaml from "js-yaml"
import {
  getHandoffConsumedFilePath,
  getHandoffFilePath,
} from "../../features/handoff"
import { HandoffSchema } from "../../features/handoff/schema"
import { createHandoffTools } from "./tools"

type AnyArgs = { [x: string]: unknown; }

/**
 * Minimal mock of the `PluginInput` shape that `createHandoffTools` needs.
 * We don't exercise the OpenCode SDK here — we only need `directory` for
 * storage writes, and we ignore `client` entirely.
 */
function makeCtx(directory: string): PluginInput {
  return {
    client: {} as PluginInput["client"],
    directory,
    project: {} as PluginInput["project"],
    worktree: directory,
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
  } as PluginInput
}

function makeContext(sessionID: string, directory: string) {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test-agent",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
  }
}

/**
 * Extract the YAML frontmatter object and markdown body from a handoff file.
 * Uses a strict, anchored regex (so the boundary is unambiguous) and
 * `yaml.JSON_SCHEMA` to mirror `parseFrontmatter()` — without the schema
 * switch, ISO 8601 strings get silently coerced to `Date` objects.
 */
function parseHandoffFile(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) {
    throw new Error("Could not locate YAML frontmatter block in handoff file")
  }
  const loaded = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
  return { frontmatter: loaded, body: match[2] }
}

/** Args shape used by the `create` action. The `action` field is added per-call. */
const VALID_CREATE_ARGS: AnyArgs = {
  topics: ["auth", "refactor"],
  user_requests: "Please refactor the auth module",
  goal: "Finish refactoring the auth module and add tests",
  work_completed: [
    "I read the existing auth module",
    "I added a new HandoffSchema",
  ],
  current_state: "Auth module is partially refactored; tests are pending",
}

describe("handoff tool", () => {
  const TEST_DIR = join(tmpdir(), `handoff-tool-test-${Date.now()}`)

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  // ---------------- Registry / shape ----------------

  test("exposes a single tool named handoff", () => {
    //#given
    const ctx = makeCtx(TEST_DIR)
    //#when
    const tools = createHandoffTools(ctx)
    //#then
    expect(Object.keys(tools)).toEqual(["handoff"])
    expect(tools.handoff).toBeDefined()
    expect(typeof tools.handoff.description).toBe("string")
    expect(tools.handoff.description.length).toBeGreaterThan(0)
  })

  // ---------------- create action ----------------

  test("action='create' writes a handoff file with valid YAML frontmatter + body", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-success")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const execute = tools.handoff.execute
    const context = makeContext("ses_abc123", projectDir)

    //#when
    const result = await execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    const filePath = getHandoffFilePath(projectDir)
    expect(existsSync(filePath)).toBe(true)
    expect(result).toContain("Handoff written to")
    expect(result).toContain("ses_abc123")
    expect(result).toContain("auth, refactor")

    const content = readFileSync(filePath, "utf-8")
    expect(content).toMatch(/^---\n/)
    expect(content).toMatch(/\n---\n\n/)
    const { frontmatter } = parseHandoffFile(content)
    expect(frontmatter.frontmatter).toBeDefined()
    expect(frontmatter.sections).toBeDefined()

    // The file must round-trip through HandoffSchema
    const parsed = HandoffSchema.safeParse(frontmatter)
    expect(parsed.success).toBe(true)
  })

  test("action='create' uses context.sessionId in the frontmatter", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-sessionid")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_explicit_id", projectDir)

    //#when
    await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { frontmatter } = parseHandoffFile(content)
    const data = frontmatter as { frontmatter: { session_id: string } }
    expect(data.frontmatter.session_id).toBe("ses_explicit_id")
  })

  test("action='create' falls back to 'unknown' for session_id when context.sessionId is empty", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-no-session")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("", projectDir)

    //#when
    await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { frontmatter } = parseHandoffFile(content)
    const data = frontmatter as { frontmatter: { session_id: string } }
    expect(data.frontmatter.session_id).toBe("unknown")
  })

  test("action='create' falls back to { sha: 'unknown' } when directory is not a git repo", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-no-git")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_xyz", projectDir)

    //#when
    await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { frontmatter } = parseHandoffFile(content)
    const data = frontmatter as { frontmatter: { git_head: { sha: string; branch?: string } } }
    expect(data.frontmatter.git_head.sha).toBe("unknown")
    expect(data.frontmatter.git_head.branch).toBeUndefined()
  })

  test("action='create' populates timestamp with a valid ISO 8601 datetime within the test window", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-ts")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_ts", projectDir)

    //#when
    const before = Date.now() - 100
    await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)
    const after = Date.now() + 100

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { frontmatter } = parseHandoffFile(content)
    const data = frontmatter as { frontmatter: { timestamp: string } }
    const ts = Date.parse(data.frontmatter.timestamp)
    expect(Number.isFinite(ts)).toBe(true)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  test("action='create' body includes all required sections in the documented format", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-body")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_body", projectDir)
    const args: AnyArgs = {
      action: "create",
      ...VALID_CREATE_ARGS,
      pending_tasks: ["Add unit tests"],
      key_files: [{ path: "src/auth.ts", purpose: "Auth module entry" }],
      important_decisions: [
        { decision: "Use Zod v4", rationale: "Schema-first validation" },
      ],
      explicit_constraints: ["Do not change public API"],
      context_for_continuation: "Next: run the test suite and open a PR",
    }

    //#when
    await tools.handoff.execute(args, context)

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { body } = parseHandoffFile(content)
    expect(body).toContain("HANDOFF CONTEXT")
    expect(body).toContain("USER REQUESTS (AS-IS)")
    expect(body).toContain("GOAL")
    expect(body).toContain("WORK COMPLETED")
    expect(body).toContain("CURRENT STATE")
    expect(body).toContain("PENDING TASKS")
    expect(body).toContain("KEY FILES")
    expect(body).toContain("IMPORTANT DECISIONS")
    expect(body).toContain("EXPLICIT CONSTRAINTS")
    expect(body).toContain("CONTEXT FOR CONTINUATION")
    expect(body).toContain("Add unit tests")
    expect(body).toContain("src/auth.ts - Auth module entry")
    expect(body).toContain("Use Zod v4: Schema-first validation")
    expect(body).toContain("Do not change public API")
    expect(body).toContain("Next: run the test suite and open a PR")
  })

  test("action='create' omits optional sections from the body when not provided", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-minimal")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_min", projectDir)

    //#when
    await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    const content = readFileSync(getHandoffFilePath(projectDir), "utf-8")
    const { body } = parseHandoffFile(content)
    expect(body).not.toContain("PENDING TASKS")
    expect(body).not.toContain("KEY FILES")
    expect(body).not.toContain("IMPORTANT DECISIONS")
    expect(body).not.toContain("EXPLICIT CONSTRAINTS")
    expect(body).not.toContain("CONTEXT FOR CONTINUATION")
  })

  test("action='create' returns an error string and writes no file when validation fails", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-bad")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_bad", projectDir)
    const filePath = getHandoffFilePath(projectDir)
    const badArgs: AnyArgs = { action: "create", ...VALID_CREATE_ARGS, topics: [] }

    //#when
    const result = await tools.handoff.execute(badArgs, context)

    //#then
    expect(result).toMatch(/^Error:/)
    expect(result.toLowerCase()).toContain("topics")
    expect(existsSync(filePath)).toBe(false)
  })

  test("action='create' returns an error string when write fails (e.g. directory is a file)", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-conflict")
    mkdirSync(projectDir, { recursive: true })
    const realFile = join(projectDir, "i-am-a-file.txt")
    await Bun.write(realFile, "blocking")
    const ctx = makeCtx(realFile)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_conflict", realFile)

    //#when
    const result = await tools.handoff.execute({ action: "create", ...VALID_CREATE_ARGS }, context)

    //#then
    expect(result).toMatch(/^Error:/)
  })

  test("action='create' success message includes the file path and topics", async () => {
    //#given
    const projectDir = join(TEST_DIR, "create-msg")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_msg", projectDir)

    //#when
    const result = await tools.handoff.execute(
      { action: "create", ...VALID_CREATE_ARGS, topics: ["alpha", "beta", "gamma"] },
      context
    )

    //#then
    expect(result).toContain(".matrixx/handoff.md")
    expect(result).toContain("alpha, beta, gamma")
  })

  // ---------------- read action ----------------

  test("action='read' returns the full handoff content (YAML + body)", async () => {
    //#given - a pre-existing handoff file
    const projectDir = join(TEST_DIR, "read-success")
    mkdirSync(join(projectDir, ".matrixx"), { recursive: true })
    const filePath = getHandoffFilePath(projectDir)
    const sample = [
      "---",
      yaml.dump(
        {
          frontmatter: {
            session_id: "ses_read",
            timestamp: "2025-01-01T00:00:00.000Z",
            git_head: { sha: "abc123" },
            topics: ["resume"],
          },
          sections: {
            user_requests: "Continue the auth refactor",
            goal: "Finish the work",
            work_completed: ["Refactored auth"],
            current_state: "In progress",
          },
        },
        { schema: yaml.JSON_SCHEMA }
      ),
      "---",
      "",
      "HANDOFF CONTEXT",
      "===============",
      "",
      "GOAL",
      "----",
      "Finish the work",
      "",
    ].join("\n")
    writeFileSync(filePath, sample, "utf-8")
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "read" }, context)

    //#then - full content returned (YAML frontmatter + markdown body)
    expect(result).toContain("---")
    expect(result).toContain("session_id: ses_read")
    expect(result).toContain("HANDOFF CONTEXT")
    expect(result).toContain("Continue the auth refactor")
  })

  test("action='read' returns a clear error when no handoff file exists", async () => {
    //#given
    const projectDir = join(TEST_DIR, "read-missing")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "read" }, context)

    //#then
    expect(result).toMatch(/^Error:/)
    expect(result).toContain("No handoff found at")
    expect(result).toContain(".matrixx/handoff.md")
  })

  // ---------------- archive action ----------------

  test("action='archive' renames handoff.md to handoff.consumed.md and reports both paths", async () => {
    //#given
    const projectDir = join(TEST_DIR, "archive-success")
    mkdirSync(join(projectDir, ".matrixx"), { recursive: true })
    const filePath = getHandoffFilePath(projectDir)
    const consumedPath = getHandoffConsumedFilePath(projectDir)
    writeFileSync(filePath, "old handoff content", "utf-8")
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "archive" }, context)

    //#then
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(consumedPath)).toBe(true)
    expect(result).toContain("Handoff archived")
    expect(result).toContain(filePath)
    expect(result).toContain(consumedPath)
  })

  test("action='archive' returns an error when there is no active handoff to archive", async () => {
    //#given
    const projectDir = join(TEST_DIR, "archive-missing")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "archive" }, context)

    //#then
    expect(result).toMatch(/^Error:/)
    expect(result).toContain("No handoff found at")
  })

  // ---------------- list action ----------------

  test("action='list' shows active + consumed handoff files", async () => {
    //#given - both handoff.md and handoff.consumed.md present
    const projectDir = join(TEST_DIR, "list-both")
    mkdirSync(join(projectDir, ".matrixx"), { recursive: true })
    writeFileSync(getHandoffFilePath(projectDir), "active", "utf-8")
    writeFileSync(getHandoffConsumedFilePath(projectDir), "consumed", "utf-8")
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "list" }, context)

    //#then
    expect(result).toContain("handoff.md")
    expect(result).toContain("handoff.consumed.md")
  })

  test("action='list' returns a clear message when no handoffs exist", async () => {
    //#given - .matrixx dir does not exist
    const projectDir = join(TEST_DIR, "list-empty")
    mkdirSync(projectDir, { recursive: true })
    const ctx = makeCtx(projectDir)
    const tools = createHandoffTools(ctx)
    const context = makeContext("ses_x", projectDir)

    //#when
    const result = await tools.handoff.execute({ action: "list" }, context)

    //#then
    expect(result).toContain("No handoffs found in .matrixx/")
  })
})
