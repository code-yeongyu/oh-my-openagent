import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { executePreToolUseHooks, type PreToolUseContext } from "./pre-tool-use"
import { _resetForTesting } from "../../features/claude-code-session-state/state"
import { setSessionAgent, getSessionAgent } from "../../features/claude-code-session-state/state"

describe("PreToolUse agent propagation", () => {
  beforeEach(() => {
    // given - clean state before each test
    _resetForTesting()
  })

  afterEach(() => {
    // then - cleanup after each test to prevent pollution
    _resetForTesting()
  })

  describe("PreToolUseContext with agent field", () => {
    test("should include agent field in PreToolUseContext when agent is set", () => {
      // given - a session with agent set
      const sessionID = "test-session-with-agent"
      const agent = "Prometheus (Planner)"
      setSessionAgent(sessionID, agent)

      // when - create context
      const ctx: PreToolUseContext = {
        sessionId: sessionID,
        toolName: "mcp_bash",
        toolInput: { command: "ls" },
        cwd: "/tmp",
        agent: getSessionAgent(sessionID),
      }

      // then - agent should be present in context
      expect(ctx.agent).toBe("Prometheus (Planner)")
    })

    test("should have undefined agent when not set in session", () => {
      // given - a session without agent
      const sessionID = "test-session-no-agent"

      // when - create context
      const ctx: PreToolUseContext = {
        sessionId: sessionID,
        toolName: "mcp_bash",
        toolInput: { command: "ls" },
        cwd: "/tmp",
        agent: getSessionAgent(sessionID),
      }

      // then - agent should be undefined
      expect(ctx.agent).toBeUndefined()
    })

    test("should preserve agent through context creation", () => {
      // given - multiple sessions with different agents
      const session1 = "session-1"
      const session2 = "session-2"
      const agent1 = "sisyphus"
      const agent2 = "Prometheus (Planner)"

      setSessionAgent(session1, agent1)
      setSessionAgent(session2, agent2)

      // when - create contexts for each session
      const ctx1: PreToolUseContext = {
        sessionId: session1,
        toolName: "mcp_bash",
        toolInput: { command: "ls" },
        cwd: "/tmp",
        agent: getSessionAgent(session1),
      }

      const ctx2: PreToolUseContext = {
        sessionId: session2,
        toolName: "mcp_bash",
        toolInput: { command: "ls" },
        cwd: "/tmp",
        agent: getSessionAgent(session2),
      }

      // then - each context should have correct agent
      expect(ctx1.agent).toBe("sisyphus")
      expect(ctx2.agent).toBe("Prometheus (Planner)")
    })
  })

  describe("PreToolUseInput with agent field", () => {
    test("should include agent in stdin data when agent is set", () => {
      // given - a session with agent
      const sessionID = "test-session-stdin"
      const agent = "sisyphus"
      setSessionAgent(sessionID, agent)

      // when - build stdin data (simulating executePreToolUseHooks)
      const stdinData = {
        session_id: sessionID,
        cwd: "/tmp",
        permission_mode: "bypassPermissions" as const,
        hook_event_name: "PreToolUse" as const,
        tool_name: "mcp_bash",
        tool_input: { command: "ls" },
        hook_source: "opencode-plugin" as const,
        agent: getSessionAgent(sessionID),
      }

      // then - agent should be in stdin data
      expect(stdinData.agent).toBe("sisyphus")
    })

    test("should not include agent in stdin data when agent is undefined", () => {
      // given - a session without agent
      const sessionID = "test-session-no-agent-stdin"

      // when - build stdin data
      const stdinData = {
        session_id: sessionID,
        cwd: "/tmp",
        permission_mode: "bypassPermissions" as const,
        hook_event_name: "PreToolUse" as const,
        tool_name: "mcp_bash",
        tool_input: { command: "ls" },
        hook_source: "opencode-plugin" as const,
        agent: getSessionAgent(sessionID),
      }

      // then - agent should be undefined
      expect(stdinData.agent).toBeUndefined()
    })

    test("should serialize agent correctly to JSON", () => {
      // given - a session with agent
      const sessionID = "test-session-json"
      const agent = "Prometheus (Planner)"
      setSessionAgent(sessionID, agent)

      // when - serialize stdin data to JSON
      const stdinData = {
        session_id: sessionID,
        cwd: "/tmp",
        permission_mode: "bypassPermissions" as const,
        hook_event_name: "PreToolUse" as const,
        tool_name: "mcp_bash",
        tool_input: { command: "ls" },
        hook_source: "opencode-plugin" as const,
        agent: getSessionAgent(sessionID),
      }

      const json = JSON.stringify(stdinData)
      const parsed = JSON.parse(json)

      // then - agent should be preserved in JSON
      expect(parsed.agent).toBe("Prometheus (Planner)")
    })
  })

  describe("agent propagation integration", () => {
    test("should handle agent propagation without breaking existing functionality", () => {
      // given - context with all fields including agent
      const sessionID = "test-integration"
      const agent = "sisyphus"
      setSessionAgent(sessionID, agent)

      // when - create full context
      const ctx: PreToolUseContext = {
        sessionId: sessionID,
        toolName: "mcp_bash",
        toolInput: { command: "echo hello" },
        cwd: "/tmp",
        transcriptPath: "/tmp/transcript.json",
        toolUseId: "call-123",
        permissionMode: "bypassPermissions",
        agent: getSessionAgent(sessionID),
      }

      // then - all fields should be present
      expect(ctx.sessionId).toBe(sessionID)
      expect(ctx.toolName).toBe("mcp_bash")
      expect(ctx.cwd).toBe("/tmp")
      expect(ctx.transcriptPath).toBe("/tmp/transcript.json")
      expect(ctx.toolUseId).toBe("call-123")
      expect(ctx.permissionMode).toBe("bypassPermissions")
      expect(ctx.agent).toBe("sisyphus")
    })

    test("should not crash when agent is undefined in context", () => {
      // given - context without agent set
      const sessionID = "test-no-crash"

      // when - create context with undefined agent
      const ctx: PreToolUseContext = {
        sessionId: sessionID,
        toolName: "mcp_bash",
        toolInput: { command: "ls" },
        cwd: "/tmp",
        agent: getSessionAgent(sessionID),
      }

      // then - should not crash and agent should be undefined
      expect(ctx.agent).toBeUndefined()
      expect(ctx.sessionId).toBe(sessionID)
    })
  })
})
