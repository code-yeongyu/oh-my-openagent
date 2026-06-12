import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { RunContext } from "./types"

export function createMockContext(sessionID: string = "test-session"): RunContext {
  return {
    client: unsafeTestValue({}),
    sessionID,
    directory: "/test",
    abortController: new AbortController(),
  }
}

export function joinWriteCalls(calls: readonly (readonly unknown[])[]): string {
  return calls.map((call) => String(call[0] ?? "")).join("")
}
