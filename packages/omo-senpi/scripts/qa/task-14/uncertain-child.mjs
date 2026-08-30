#!/usr/bin/env bun
import { createReceiptStore } from "../../../src/components/thread/receipts.ts"
import { createConnection } from "node:net"
import { argv } from "node:process"
const [state, socketPath, sessionId] = argv.slice(2)
const input = { caller_session_id: "caller", tool: "thread_send", idempotency_key: "t14-uncertain", args: { thread: sessionId, message: "t14-uncertain-delivery" } }
const store = createReceiptStore({ directory: state, instance_id: `child-${process.pid}` })
const admission = store.begin(input)
if (admission.kind !== "accepted") throw new Error(`admission failed: ${JSON.stringify(admission)}`)
const socket = createConnection(socketPath)
let buffer = ""
socket.on("data", (chunk) => {
  buffer += chunk.toString()
  const n = buffer.indexOf("\n")
  if (n < 0) return
  socket.destroy()
  process.kill(process.pid, "SIGKILL")
})
socket.on("connect", () => socket.write(`${JSON.stringify({ id: "uncertain-child", type: "prompt", sessionId, message: "t14-uncertain-delivery" })}\n`))
