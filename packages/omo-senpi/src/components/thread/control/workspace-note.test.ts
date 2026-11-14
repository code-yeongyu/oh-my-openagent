import { expect, test } from "bun:test"
import { workspaceNote } from "./local-session-host"

// Review LOW of #13459: with no caller workspace root, scoped addressing answers caller_context_missing for every
// thread, so the create result must not claim the thread is outside a workspace.
test("#given a caller with no workspace root #when a local thread is created #then the result carries no workspace note", () => {
  const thread = {
    sessionId: "t-1",
    thread_id: "t-1",
    name: "x",
    status: "live" as const,
    cwd: "/tmp/elsewhere",
    created_at: "2026-11-14T00:00:00.000Z",
    updated_at: null,
    link: "[x](omo-thread://v1/t-1)",
  }
  expect(workspaceNote(thread, "")).toEqual({})
})
