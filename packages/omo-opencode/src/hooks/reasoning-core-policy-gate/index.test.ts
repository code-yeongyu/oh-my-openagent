import { chmodSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { _resetForTesting as resetProcessCleanup } from "../../features/background-agent/process-cleanup"
import { createReasoningCoreClient } from "./reasoning-core-client"
import { ReasoningCoreInfrastructureError } from "./client/infrastructure-error"

// Path to real reasoning-core binary (set via env var or use default dev path)
const REAL_BINARY_PATH = process.env.REASONING_CORE_BINARY_PATH ?? "/Users/unluckyg/Documents/reasoning-core/target/release/reasoning-core"

function restoreReasoningCoreBinaryPath(originalBinaryPath: string | undefined): void {
  if (originalBinaryPath === undefined) {
    delete process.env.REASONING_CORE_BINARY_PATH
    return
  }

  process.env.REASONING_CORE_BINARY_PATH = originalBinaryPath
}

describe("createReasoningCoreClient", () => {
  beforeEach(() => {
    resetProcessCleanup()
  })

  afterEach(() => {
    resetProcessCleanup()
  })

  it("denies an empty task", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-empty-task",
        args: {},
      },
    })

    //#then
    expect(result).toMatchObject({ allow: false })
  })

  it("allows a valid task with required fields", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-valid-task",
        args: {
          prompt: "Do the thing",
          description: "A valid delegated task",
          load_skills: ["reasoning"],
          category: "general",
        },
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("allows delegated work task when load_skills is an empty array", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-delegated-empty-skills",
        args: {
          prompt: "Implement the change",
          description: "Fix type error",
          load_skills: [],
          category: "quick",
          run_in_background: false,
        },
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("allows internal orchestration task with internal subagent and empty load_skills", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-internal-subagent",
        args: {
          prompt: "Find patterns",
          description: "Explore codebase",
          load_skills: [],
          subagent_type: "explore",
          run_in_background: true,
        },
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("allows oracle internal orchestration task with empty load_skills", async () => {
    //#given
    const client = createReasoningCoreClient({
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-internal-oracle",
        args: {
          prompt: "Review the approach",
          description: "Oracle review",
          load_skills: [],
          subagent_type: "oracle",
          run_in_background: false,
        },
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("allows internal orchestration continuation with session_id and empty load_skills", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "task",
        sessionID: "session-continuation",
        args: {
          prompt: "Continue the work",
          description: "Resume session",
          load_skills: [],
          session_id: "ses_existing",
          run_in_background: false,
        },
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("allows non-task tools", async () => {
    //#given
    const client = createReasoningCoreClient({ 
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000 
    })

    //#when
    const result = await client.evaluate({
      candidate: {
        tool: "read",
        sessionID: "session-read",
        args: {},
      },
    })

    //#then
    expect(result).toMatchObject({ allow: true })
  })

  it("throws ReasoningCoreInfrastructureError when reasoning-core is unavailable", async () => {
    //#given
    const client = createReasoningCoreClient({
      mode: "stdio",
      binaryPath: "/nonexistent",
      timeoutMs: 5000,
    })

    //#when / #then
    await expect(
      client.evaluate({
        candidate: {
          tool: "task",
          sessionID: "session-missing-binary",
          args: {
            prompt: "Do the thing",
            description: "A valid delegated task",
            load_skills: ["reasoning"],
            category: "general",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ReasoningCoreInfrastructureError)
  })

  it("uses environment variable for binary path when set", async () => {
    //#given
    const originalEnv = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = "/nonexistent/from/env"

    try {
      //#when / #then
      const client = createReasoningCoreClient({ mode: "stdio", timeoutMs: 5000 })
      await expect(
        client.evaluate({
          candidate: {
            tool: "task",
            sessionID: "session-env-binary",
            args: {
              prompt: "Do the thing",
              description: "A valid delegated task",
              load_skills: ["reasoning"],
              category: "general",
            },
          },
        }),
      ).rejects.toBeInstanceOf(ReasoningCoreInfrastructureError)
    } finally {
      //#cleanup
      restoreReasoningCoreBinaryPath(originalEnv)
    }
  })

  it("config.binaryPath takes precedence over environment variable", async () => {
    //#given
    const originalEnv = process.env.REASONING_CORE_BINARY_PATH
    process.env.REASONING_CORE_BINARY_PATH = "/nonexistent/bad/path"

    try {
      //#when - config.binaryPath explicitly set to real binary (overriding bad env var)
      const client = createReasoningCoreClient({
        binaryPath: REAL_BINARY_PATH,
        timeoutMs: 5000,
      })
      const result = await client.evaluate({
        candidate: {
          tool: "task",
          sessionID: "session-precedence",
          args: {
            prompt: "Do the thing",
            description: "A valid delegated task",
            load_skills: ["reasoning"],
            category: "general",
          },
        },
      })

      //#then - succeeds because config.binaryPath (real binary) takes precedence over env var (bad path)
      expect(result).toMatchObject({ allow: true })
    } finally {
      //#cleanup
      restoreReasoningCoreBinaryPath(originalEnv)
    }
  })

  it("falls back to dev path when default 'reasoning-core' is not in PATH", async () => {
    //#given - no env var, no config, PATH pulito
    const originalEnv = process.env.REASONING_CORE_BINARY_PATH
    const originalPath = process.env.PATH
    delete process.env.REASONING_CORE_BINARY_PATH
    process.env.PATH = "/usr/bin:/bin" // PATH minimo, senza reasoning-core

    try {
      //#when - usa default "reasoning-core" che fallisce (non in PATH), poi fallback a dev path
      const client = createReasoningCoreClient({ timeoutMs: 5000 })
      const result = await client.evaluate({
        candidate: {
          tool: "task",
          sessionID: "session-fallback",
          args: {
            prompt: "Do the thing",
            description: "A valid delegated task",
            load_skills: ["reasoning"],
            category: "general",
          },
        },
      })

      //#then - successo via dev fallback path
      expect(result).toMatchObject({ allow: true })
    } finally {
      //#cleanup
      restoreReasoningCoreBinaryPath(originalEnv)
      if (originalPath) {
        process.env.PATH = originalPath
      } else {
        delete process.env.PATH
      }
    }
  })

  it("tracks metacognitive history across repeated checks in the same session", async () => {
    //#given
    const client = createReasoningCoreClient({
      mode: "stdio",
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    try {
      //#when
      const first = await client.check("metacognition-session", {
        iteration: 0,
        domain_reduction_rate: 0,
        domains_solved: 0,
        domains_total: 0,
        extensions_count: 1,
      })
      const second = await client.check("metacognition-session", {
        iteration: 1,
        domain_reduction_rate: 0,
        domains_solved: 0,
        domains_total: 0,
        extensions_count: 1,
      })
      const third = await client.check("metacognition-session", {
        iteration: 2,
        domain_reduction_rate: 0,
        domains_solved: 0,
        domains_total: 0,
        extensions_count: 1,
      })
      const status = await client.status("metacognition-session")

      //#then
      expect(first.signal).toBe("Continue")
      expect(second.signal).toBe("Continue")
      expect(third.signal).toBe("Looping")
      expect(status.reasoning_history).toHaveLength(3)
    } finally {
      client.disposeSession("metacognition-session")
    }
  })

  it("supports kbQuery for learned planning insights", async () => {
    //#given
    const client = createReasoningCoreClient({
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    //#when
    const result = await client.kbQuery({
      content_type: "insight",
      keyword: "",
      layer: "Learned",
      similarity_query: "planning constraints scope boundaries",
      tags: ["planning"],
    })

    //#then
    expect(result.count).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(result.entries)).toBe(true)
  })

  it("supports kbAdd plus kbRemove for learned planning insights", async () => {
    const client = createReasoningCoreClient({
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    const created = await client.kbAdd({
      layer: "Learned",
      content: {
        Insight: {
          problem_type: "reasoning_core_client_kb_remove_smoke",
          lesson: "Temporary test lesson for kbRemove smoke coverage.",
          example: "Temporary test example for kbRemove smoke coverage.",
        },
      },
      tags: ["kb-remove-smoke", "planning"],
    })

    await expect(client.kbRemove({ id: created.id })).resolves.toBeUndefined()
  })

  it("supports constrain plus status for planning sessions", async () => {
    //#given
    const client = createReasoningCoreClient({
      mode: "stdio",
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    try {
      //#when
      await client.constrain("planning-session", {
        variables: [
          { name: "goal_present", domain: [0, 1] },
          { name: "scope_present", domain: [0, 1] },
        ],
      })
      await client.constrain("planning-session", {
        constraint: { Equals: { variable: "goal_present", value: 1 } },
        question: "goal presence",
      })
      const status = await client.status("planning-session")

      //#then
      expect(status.session_active).toBe(true)
      expect(status.domains.goal_present).toEqual([1])
    } finally {
      client.disposeSession("planning-session")
    }
  })

  it("supports solve for a simple planning gate problem", async () => {
    //#given
    const client = createReasoningCoreClient({
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })

    //#when
    const result = await client.solve({
      description: "simple planning gate",
      variables: [
        { name: "goal_present", domain: [0, 1] },
        { name: "scope_present", domain: [0, 1] },
      ],
      initial_constraints: [
        { constraint: { Equals: { variable: "goal_present", value: 1 } }, question: "goal" },
        { constraint: { Equals: { variable: "scope_present", value: 1 } }, question: "scope" },
      ],
      incremental_constraints: [],
      max_iterations: 1,
      theory: {
        premises: [
          { formula: "goal_present(current)", kind: "ordinary" },
          { formula: "scope_present(current)", kind: "ordinary" },
        ],
        strict_rules: [
          { id: "allow", antecedents: ["goal_present(current)", "scope_present(current)"], consequent: "allow_action(current)" },
        ],
        defeasible_rules: [],
        preferences: [],
        classical_negation: true,
      },
    })

    //#then
    expect(result.argumentation_result?.conclusions?.["allow_action(current)"]?.status).toBe("Accepted")
  })

  it.skip("registers and unregisters process cleanup handlers for session-scoped clients [V1 behavior removed in transport refactor]", async () => {
    const client = createReasoningCoreClient({
      binaryPath: REAL_BINARY_PATH,
      timeoutMs: 5000,
    })
    client.dispose()
  })

  it("does not leak cleanup listeners when session initialization fails", async () => {
    //#given
    const sigintBefore = process.listeners("SIGINT").length
    const sigtermBefore = process.listeners("SIGTERM").length
    const beforeExitBefore = process.listeners("beforeExit").length
    const exitBefore = process.listeners("exit").length
    const client = createReasoningCoreClient({
      mode: "stdio",
      binaryPath: "/nonexistent/init-failure",
      timeoutMs: 100,
    })

    //#when
    await expect(
      client.check("failed-init-session", {
        iteration: 0,
        domain_reduction_rate: 0,
        domains_solved: 0,
        domains_total: 0,
        extensions_count: 1,
      }),
    ).rejects.toThrow()

    //#then
    expect(process.listeners("SIGINT")).toHaveLength(sigintBefore)
    expect(process.listeners("SIGTERM")).toHaveLength(sigtermBefore)
    expect(process.listeners("beforeExit")).toHaveLength(beforeExitBefore)
    expect(process.listeners("exit")).toHaveLength(exitBefore)
  })

  it("escalates to SIGKILL when a child ignores SIGTERM", async () => {
    //#given
    const scriptPath = join(tmpdir(), `reasoning-core-ignore-term-${randomUUID()}.js`)
    writeFileSync(
      scriptPath,
      "#!/usr/bin/env node\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    )
    chmodSync(scriptPath, 0o755)

    const countChildren = () => {
      const proc = Bun.spawnSync(["bash", "-lc", `pgrep -P ${process.pid} -f '${scriptPath.replace(/'/g, `'\\''`)}' | wc -l`], {
        stdout: "pipe",
        stderr: "pipe",
      })
      return Number(new TextDecoder().decode(proc.stdout).trim() || "0")
    }

    const client = createReasoningCoreClient({
      mode: "stdio",
      binaryPath: scriptPath,
      timeoutMs: 50,
    })

    try {
      //#when / #then
      await expect(
        client.evaluate({
          candidate: {
            tool: "read",
            sessionID: "sigkill-fallback",
            args: { filePath: "/tmp/ignored" },
          },
        }),
      ).rejects.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 1200))

      //#then - no orphan children left behind
      expect(countChildren()).toBe(0)
    } finally {
      client.dispose()
      rmSync(scriptPath, { force: true })
    }
  })
})
