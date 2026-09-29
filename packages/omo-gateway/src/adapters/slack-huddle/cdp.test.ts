import { expect, test } from "bun:test"
import { CdpConnection, CdpError, type CdpTransport } from "./cdp"

function fakeTransport() {
  let onMessage: ((m: string) => void) | null = null
  let onClose: ((r: string) => void) | null = null
  const sent: Record<string, unknown>[] = []
  const transport: CdpTransport = {
    write(message) {
      sent.push(JSON.parse(message) as Record<string, unknown>)
    },
    onMessage(handler) {
      onMessage = handler
    },
    onClose(handler) {
      onClose = handler
    },
    close() {},
  }
  return {
    transport,
    sent,
    reply: (message: unknown) => onMessage?.(JSON.stringify(message)),
    drop: (reason: string) => onClose?.(reason),
  }
}

test("a command carries its id and session and resolves with the browser's result", async () => {
  const fake = fakeTransport()
  const cdp = new CdpConnection(fake.transport)
  const pending = cdp.send("Runtime.evaluate", { expression: "1+1" }, { sessionId: "S1" })
  expect(fake.sent[0]).toEqual({ id: 1, method: "Runtime.evaluate", params: { expression: "1+1" }, sessionId: "S1" })
  fake.reply({ id: 1, result: { result: { value: 2 } } })
  expect(await pending).toEqual({ result: { value: 2 } })
})

test("a protocol error rejects with the failing method and the browser's message", async () => {
  const fake = fakeTransport()
  const cdp = new CdpConnection(fake.transport)
  const pending = cdp.send("Page.navigate")
  fake.reply({ id: 1, error: { code: -32000, message: "Cannot navigate to invalid URL" } })
  const error = await pending.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(CdpError)
  expect((error as CdpError).code).toBe(-32000)
  expect((error as CdpError).message).toBe("Page.navigate failed: Cannot navigate to invalid URL")
})

test("events reach their listeners with the session they came from, and unsubscribing stops them", () => {
  const fake = fakeTransport()
  const cdp = new CdpConnection(fake.transport)
  const seen: string[] = []
  const off = cdp.on("Target.attachedToTarget", (params, sessionId) => {
    seen.push(`${String(params.waitingForDebugger)}@${sessionId ?? "-"}`)
  })
  fake.reply({ method: "Target.attachedToTarget", params: { waitingForDebugger: true }, sessionId: "S2" })
  off()
  fake.reply({ method: "Target.attachedToTarget", params: { waitingForDebugger: false }, sessionId: "S3" })
  expect(seen).toEqual(["true@S2"])
})

test("once resolves on the first matching event and rejects when the browser never sends it", async () => {
  const fake = fakeTransport()
  const cdp = new CdpConnection(fake.transport)
  const waited = cdp.once("Target.targetCreated", (params) => (params.targetInfo as { type?: string } | undefined)?.type === "page", 5_000)
  fake.reply({ method: "Target.targetCreated", params: { targetInfo: { type: "other" } } })
  fake.reply({ method: "Target.targetCreated", params: { targetInfo: { type: "page", targetId: "T1" } } })
  expect(((await waited).params.targetInfo as { targetId: string }).targetId).toBe("T1")

  const never = cdp.once("Target.targetCreated", () => false, 10)
  expect(await never.then(() => "resolved", (e: Error) => e.message)).toBe("timed out after 10 ms waiting for Target.targetCreated")
})

test("losing the browser rejects every command in flight instead of hanging the caller", async () => {
  const fake = fakeTransport()
  const cdp = new CdpConnection(fake.transport)
  const pending = cdp.send("Runtime.evaluate")
  fake.drop("the browser exited with code 133")
  expect(await pending.then(() => "resolved", (e: Error) => e.message)).toBe("Runtime.evaluate lost the browser connection (the browser exited with code 133)")
  expect(cdp.isClosed).toBe(true)
  expect(await cdp.send("Runtime.evaluate").then(() => "resolved", (e: Error) => e.message)).toContain("cdp connection is closed")
})
