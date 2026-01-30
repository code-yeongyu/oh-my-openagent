import { describe, it, expect } from "bun:test"
import {
  MailboxMessageSchema,
  PermissionRequestSchema,
  PermissionResponseSchema,
  ShutdownRequestSchema,
  TaskAssignmentSchema,
  JoinRequestSchema,
  ProtocolMessageSchema,
} from "./types"

describe("MailboxMessageSchema", () => {
  //#given a valid mailbox message
  //#when parsing
  //#then it should succeed
  it("parses valid message", () => {
    const msg = {
      from: "agent-001",
      text: '{"type":"idle_notification"}',
      timestamp: "2026-01-27T10:00:00Z",
      read: false,
    }
    expect(MailboxMessageSchema.safeParse(msg).success).toBe(true)
  })

  //#given a message with optional color
  //#when parsing
  //#then it should succeed
  it("parses message with color", () => {
    const msg = {
      from: "agent-001",
      text: "{}",
      timestamp: "2026-01-27T10:00:00Z",
      color: "blue",
      read: true,
    }
    expect(MailboxMessageSchema.safeParse(msg).success).toBe(true)
  })
})

describe("ProtocolMessageSchema", () => {
  //#given permission_request message
  //#when parsing
  //#then it should succeed
  it("parses permission_request", () => {
    const msg = {
      type: "permission_request",
      requestId: "req-123",
      toolName: "Bash",
      input: { command: "rm -rf /" },
      agentId: "agent-001",
      timestamp: Date.now(),
    }
    expect(PermissionRequestSchema.safeParse(msg).success).toBe(true)
  })

  //#given permission_response message
  //#when parsing
  //#then it should succeed
  it("parses permission_response", () => {
    const approved = {
      type: "permission_response",
      requestId: "req-123",
      decision: "approved",
      updatedInput: { command: "ls" },
    }
    expect(PermissionResponseSchema.safeParse(approved).success).toBe(true)

    const rejected = {
      type: "permission_response",
      requestId: "req-123",
      decision: "rejected",
      feedback: "Too dangerous",
    }
    expect(PermissionResponseSchema.safeParse(rejected).success).toBe(true)
  })

  //#given shutdown_request message
  //#when parsing
  //#then it should succeed
  it("parses shutdown messages", () => {
    const request = { type: "shutdown_request" }
    expect(ShutdownRequestSchema.safeParse(request).success).toBe(true)
  })

  //#given task_assignment message
  //#when parsing
  //#then it should succeed
  it("parses task_assignment", () => {
    const msg = {
      type: "task_assignment",
      taskId: "1",
      subject: "Fix bug",
      description: "Fix the auth bug",
      assignedBy: "team-lead",
      timestamp: Date.now(),
    }
    expect(TaskAssignmentSchema.safeParse(msg).success).toBe(true)
  })

  //#given join_request message
  //#when parsing
  //#then it should succeed
  it("parses join_request", () => {
    const msg = {
      type: "join_request",
      agentName: "new-agent",
      sessionId: "sess-123",
    }
    expect(JoinRequestSchema.safeParse(msg).success).toBe(true)
  })
})
