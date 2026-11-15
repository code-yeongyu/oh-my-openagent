import type { AuditEvent } from "@oh-my-opencode/senpi-desktop-protocol"
import { describe, expect, it } from "vitest"
import { runComputerSteps } from "../src/run/runtime"
import { snapshot } from "./control-harness"

/**
 * An engine channel ordered like the real engine's outbox: a request's audit notification is written right after its
 * reply and before any later reply, so it reaches the host only once the next request is answered.
 */
function engineAuditingAfterReply() {
  const listeners: ((event: AuditEvent) => void)[] = []
  let pending: AuditEvent | undefined
  const deliverPending = () => {
    const event = pending
    pending = undefined
    if (event !== undefined) for (const listener of listeners) listener(event)
  }
  const service = {
    call: async (method: string) => {
      deliverPending()
      if (method === "click") {
        pending = { action: "click", target: "desktop", delivery: "background", durationMs: 1 } as AuditEvent
        return null
      }
      return {}
    },
    auditBarrier: async () => deliverPending(),
    onAudit: (listener: (event: AuditEvent) => void) => {
      listeners.push(listener)
      return () => void listeners.splice(listeners.indexOf(listener), 1)
    },
    revokeControl: async () => undefined,
    reportError: () => undefined,
  }
  return service
}

describe("audit records of a call's own requests", () => {
  it("keeps the audit of the call's last request, which the engine sends after that request's reply", async () => {
    // Given
    const service = engineAuditingAfterReply()

    // When
    const result = await runComputerSteps(
      { toolCallId: "call-click", snapshot: snapshot(false), timeoutMs: 5_000 },
      { service },
      ({ desktop }) => desktop.click(1, 1),
    )

    // Then
    expect(result.audit).toEqual([expect.objectContaining({ action: "click", toolCallId: "call-click" })])
  })

  it.each(["abort", "deadline"] as const)("rejects at once on %s while the barrier never answers", async (end) => {
    // Given: an engine that never answers the barrier
    const service = { ...engineAuditingAfterReply(), auditBarrier: () => new Promise<void>(() => undefined) }
    const controller = new AbortController()
    const running = runComputerSteps(
      {
        toolCallId: "call-hang",
        snapshot: snapshot(false),
        timeoutMs: end === "deadline" ? 50 : 60_000,
        signal: controller.signal,
      },
      { service },
      ({ desktop }) => desktop.click(1, 1),
    )

    // When
    if (end === "abort") controller.abort()

    // Then
    await expect(running).rejects.toMatchObject({ reason: end === "abort" ? "aborted" : "timeout" })
  })
})
