import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { platform } from "node:process"

import {
  createPermissionGateHook,
  type PermissionGateDeps,
} from "./hook"
import { resolveToolPermission } from "./resolve"
import type {
  OmoToolPermissionValue,
} from "@oh-my-opencode/omo-config-core"
import {
  clearPermissionGateAuditHomedirOverride,
  setPermissionGateAuditHomedirOverride,
} from "./audit"
import {
  createSessionPermissionCache,
  resetSessionPermissionCacheForTesting,
} from "./session-cache"

type TestContext = {
  auditRoot: string
  deps: PermissionGateDeps
}

function setupContext(label: string): TestContext {
  const auditRoot = mkdtempSync(join(tmpdir(), `omo-permission-gate-${label}-`))
  setPermissionGateAuditHomedirOverride(auditRoot)
  const deps: PermissionGateDeps = {
    pluginConfig: {},
    cache: createSessionPermissionCache(),
  }
  return { auditRoot, deps }
}

function teardownContext(ctx: TestContext): void {
  clearPermissionGateAuditHomedirOverride()
  resetSessionPermissionCacheForTesting()
  try {
    rmSync(ctx.auditRoot, { recursive: true, force: true })
  } catch {
    // best-effort cleanup; test artifacts
  }
}

function makeArgs(args: Record<string, unknown>): { args: Record<string, unknown> } {
  return { args }
}

function runGate(ctx: TestContext, sessionID: string, tool: string, args: Record<string, unknown>) {
  const hook = createPermissionGateHook(ctx.deps)
  return hook["tool.execute.before"](
    { tool, sessionID, callID: `call-${tool}` },
    makeArgs(args),
  )
}

describe("permission-gate", () => {
  describe("#given a read-only tool called without an explicit override", () => {
    it("defaults to allow for `read`", async () => {
      const ctx = setupContext("read-default")
      try {
        // when
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "read",
          targetPath: "/tmp/example.txt",
          sessionID: "ses_read_1",
          cache: ctx.deps.cache,
        })

        // then
        expect(decision.value).toBe("allow")
        expect(decision.source).toBe("default")
      } finally {
        teardownContext(ctx)
      }
    })

    it("defaults to allow for `grep`", async () => {
      const ctx = setupContext("grep-default")
      try {
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "grep",
          targetPath: "/repo/src",
          sessionID: "ses_grep_1",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("allow")
      } finally {
        teardownContext(ctx)
      }
    })

    it("defaults to allow for `glob`", async () => {
      const ctx = setupContext("glob-default")
      try {
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "glob",
          targetPath: "/repo",
          sessionID: "ses_glob_1",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("allow")
      } finally {
        teardownContext(ctx)
      }
    })

    it("defaults to allow for `session_*` tools", async () => {
      const ctx = setupContext("session-default")
      try {
        for (const tool of ["session_list", "session_read", "session_search", "session_info"]) {
          const decision = resolveToolPermission({
            pluginConfig: ctx.deps.pluginConfig,
            tool,
            targetPath: undefined,
            sessionID: `ses_${tool}`,
            cache: ctx.deps.cache,
          })
          expect(decision.value).toBe("allow")
        }
      } finally {
        teardownContext(ctx)
      }
    })
  })

  describe("#given a mutating tool called without an explicit override", () => {
    it("defaults to ask for `bash`", async () => {
      const ctx = setupContext("bash-default")
      try {
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "bash",
          targetPath: undefined,
          sessionID: "ses_bash_1",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("ask")
        expect(decision.source).toBe("default")
      } finally {
        teardownContext(ctx)
      }
    })

    it("defaults to ask for `edit`", async () => {
      const ctx = setupContext("edit-default")
      try {
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "edit",
          targetPath: "/repo/src/x.ts",
          sessionID: "ses_edit_1",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("ask")
      } finally {
        teardownContext(ctx)
      }
    })

    it("defaults to ask for `write`", async () => {
      const ctx = setupContext("write-default")
      try {
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "write",
          targetPath: "/repo/src/x.ts",
          sessionID: "ses_write_1",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("ask")
      } finally {
        teardownContext(ctx)
      }
    })
  })

  describe("#given conflicting explicit user overrides", () => {
    it("treats `deny` as authoritative over `allow`", () => {
      const ctx = setupContext("deny-vs-allow")
      try {
        ctx.deps.cache.setUserOverride({
          sessionID: "ses_crit_1",
          tool: "bash",
          targetPath: "/repo/scripts/critical.sh",
          value: "deny",
        })
        ctx.deps.cache.setUserOverride({
          sessionID: "ses_crit_1",
          tool: "bash",
          targetPath: "/repo/scripts/critical.sh",
          value: "allow",
        })

        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "bash",
          targetPath: "/repo/scripts/critical.sh",
          sessionID: "ses_crit_1",
          cache: ctx.deps.cache,
        })

        expect(decision.value).toBe("deny")
        expect(decision.source).toBe("user_override")
      } finally {
        teardownContext(ctx)
      }
    })
  })

  describe("#given an `ask` decision", () => {
    it("caches the first decision per (session, tool, target-path) and reuses it", async () => {
      const ctx = setupContext("ask-once")
      try {
        ctx.deps.cache.setUserOverride({
          sessionID: "ses_ask_1",
          tool: "bash",
          targetPath: "/repo/scripts/run.sh",
          value: "ask",
        })

        // when: first call resolves ask and caches the user's "accept"
        const first = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "bash",
          targetPath: "/repo/scripts/run.sh",
          sessionID: "ses_ask_1",
          cache: ctx.deps.cache,
        })
        expect(first.value).toBe("ask")
        ctx.deps.cache.recordAskDecision({
          sessionID: "ses_ask_1",
          tool: "bash",
          targetPath: "/repo/scripts/run.sh",
        })

        // when: second call observes the cached decision and resolves to allow
        const second = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "bash",
          targetPath: "/repo/scripts/run.sh",
          sessionID: "ses_ask_1",
          cache: ctx.deps.cache,
        })

        // then
        expect(second.value).toBe("allow")
        expect(second.source).toBe("session_cache")
      } finally {
        teardownContext(ctx)
      }
    })

    it("does NOT cache across distinct (tool, target-path) pairs", async () => {
      const ctx = setupContext("ask-distinct-paths")
      try {
        ctx.deps.cache.setUserOverride({
          sessionID: "ses_ask_2",
          tool: "bash",
          targetPath: "/repo/scripts/a.sh",
          value: "ask",
        })
        ctx.deps.cache.recordAskDecision({
          sessionID: "ses_ask_2",
          tool: "bash",
          targetPath: "/repo/scripts/a.sh",
        })

        const differentTarget = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "bash",
          targetPath: "/repo/scripts/b.sh",
          sessionID: "ses_ask_2",
          cache: ctx.deps.cache,
        })
        expect(differentTarget.value).toBe("ask")
      } finally {
        teardownContext(ctx)
      }
    })
  })

  describe("#given the gate is wired to a hook", () => {
    it("denies by throwing for a denied tool, after writing an audit entry", async () => {
      const ctx = setupContext("hook-deny")
      try {
        ctx.deps.pluginConfig.tools = {
          bash: { permission: "deny" },
        }

        const hook = createPermissionGateHook(ctx.deps)

        // when/then
        await expect(
          runGate(ctx, "ses_hook_deny", "bash", { command: "rm -rf /" }),
        ).rejects.toThrow(/Permission denied for tool 'bash'/)

        const date = new Date().toISOString().slice(0, 10)
        const auditPath = join(ctx.auditRoot, ".omo", "audit", date, "ses_hook_deny.jsonl")
        const auditLines = readFileSync(auditPath, "utf-8").trim().split("\n")
        expect(auditLines).toHaveLength(1)
        const entry = JSON.parse(auditLines[0] ?? "{}")
        expect(entry.tool).toBe("bash")
        expect(entry.decision).toBe("deny")
        expect(entry.sessionID).toBe("ses_hook_deny")
      } finally {
        teardownContext(ctx)
      }
    })

    it("allows a normal tool call without audit log noise when default-allow", async () => {
      const ctx = setupContext("hook-default-allow")
      try {
        const hook = createPermissionGateHook(ctx.deps)
        const date = new Date().toISOString().slice(0, 10)
        const auditPath = join(ctx.auditRoot, ".omo", "audit", date, "ses_hook_allow.jsonl")

        await expect(
          runGate(ctx, "ses_hook_allow", "read", { filePath: "/repo/x.ts" }),
        ).resolves.toBeUndefined()

        try {
          const lines = readFileSync(auditPath, "utf-8").trim().split("\n").filter(Boolean)
          for (const line of lines) {
            const entry = JSON.parse(line)
            expect(entry.tool).not.toBe("read")
          }
        } catch (error) {
          // No file means zero audit entries, which is acceptable for default-allow.
          if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error
        }
      } finally {
        teardownContext(ctx)
      }
    })

    it("writes an audit entry on every `ask` decision", async () => {
      const ctx = setupContext("hook-ask-audit")
      try {
        ctx.deps.pluginConfig.tools = {
          write: { permission: "ask" },
        }
        await runGate(ctx, "ses_hook_ask_1", "write", { filePath: "/repo/x.ts" })
        await runGate(ctx, "ses_hook_ask_1", "write", { filePath: "/repo/x.ts" })
        await runGate(ctx, "ses_hook_ask_1", "write", { filePath: "/repo/y.ts" })

        const date = new Date().toISOString().slice(0, 10)
        const auditPath = join(ctx.auditRoot, ".omo", "audit", date, "ses_hook_ask_1.jsonl")
        const lines = readFileSync(auditPath, "utf-8").trim().split("\n").filter(Boolean)
        expect(lines.length).toBeGreaterThanOrEqual(2)
        const decoded = lines.map((line) => JSON.parse(line))
        // The first call records an `ask` decision; the second call resolves
        // to allow from the session cache, so the audit captures both.
        expect(decoded[0]?.decision).toBe("ask")
        expect(decoded.some((entry) => entry.decision === "allow" && entry.source === "session_cache")).toBe(true)
      } finally {
        teardownContext(ctx)
      }
    })

    it("writes the audit log with mode 600 when supported", async () => {
      // skip on Windows: chmod is not the security boundary there.
      if (platform === "win32") {
        return
      }
      const ctx = setupContext("hook-audit-mode")
      try {
        const { statSync } = await import("node:fs")
        ctx.deps.pluginConfig.tools = {
          bash: { permission: "deny" },
        }
        const hook = createPermissionGateHook(ctx.deps)
        try {
          await runGate(ctx, "ses_hook_mode", "bash", { command: "ls" })
        } catch {
          // ignore; we only care about audit log mode
        }
        const date = new Date().toISOString().slice(0, 10)
        const auditPath = join(ctx.auditRoot, ".omo", "audit", date, "ses_hook_mode.jsonl")
        const stat = statSync(auditPath)
        // Mask off type bits, keep permission bits.
        const permissionBits = stat.mode & 0o777
        expect(permissionBits).toBe(0o600)
      } finally {
        teardownContext(ctx)
      }
    })
  })

  describe("#given the schema-level overrides", () => {
    it("honors a tool-level explicit override", async () => {
      const ctx = setupContext("config-override")
      try {
        ctx.deps.pluginConfig.tools = {
          read: { permission: "deny" },
        }
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "read",
          targetPath: "/repo/x.ts",
          sessionID: "ses_cfg_read",
          cache: ctx.deps.cache,
        })
        expect(decision.value).toBe("deny")
        expect(decision.source).toBe("tools_override")
      } finally {
        teardownContext(ctx)
      }
    })

    it("honors a per-agent profile override above the default", async () => {
      const ctx = setupContext("agent-profile")
      try {
        const agentOverrides = {
          prometheus: {
            tools: {
              read: { permission: "ask" as OmoToolPermissionValue },
            },
          },
        }
        const decision = resolveToolPermission({
          pluginConfig: ctx.deps.pluginConfig,
          tool: "read",
          targetPath: "/repo/x.md",
          sessionID: "ses_agent_prom",
          cache: ctx.deps.cache,
          agentName: "prometheus",
          agentOverrides: agentOverrides as never,
        })
        expect(decision.value).toBe("ask")
        expect(decision.source).toBe("agent_override")
      } finally {
        teardownContext(ctx)
      }
    })
  })
})

beforeEach(() => {
  resetSessionPermissionCacheForTesting()
})

afterEach(() => {
  resetSessionPermissionCacheForTesting()
  clearPermissionGateAuditHomedirOverride()
})
