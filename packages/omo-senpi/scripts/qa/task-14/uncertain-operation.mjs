#!/usr/bin/env bun
import { join } from "node:path"
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { createReceiptStore } from "../../../src/components/thread/receipts.ts"
import { HostClient, makeScratch, startFakeModelServer, writeMockModelsJson, startRealHost, installCleanupHooks, cleanupAllAndWait, countUserTurns } from "../thread-tools/lib/harness.mjs"
import { assert, processSnapshot, cleanupReceipt, waitGone } from "./common.mjs"

const before = processSnapshot()
installCleanupHooks()
let qa, host, fake, sender
try {
  qa = makeScratch("t14-uncertain")
  fake = await startFakeModelServer([{ text: "uncertain-ack" }])
  writeMockModelsJson(qa.agentDir, fake)
  host = await startRealHost(qa, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  const client = await HostClient.connect(host.socket, "uncertain")
  const opened = await client.openSession({ cwd: qa.cwd, sessionPath: join(qa.sessionDir, "uncertain.jsonl") })
  const state = join(qa.dir, "receipts")
  sender = spawn(process.execPath, [new URL("./uncertain-child.mjs", import.meta.url).pathname, state, host.socket, opened.routingId], { stdio: ["ignore", "pipe", "pipe"] })
  await waitGone(sender.pid, 10000)
  const restarted = createReceiptStore({ directory: state, instance_id: "after-real-sigkill" })
  const result = restarted.begin({ caller_session_id: "caller", tool: "thread_send", idempotency_key: "t14-uncertain", args: { thread: opened.routingId, message: "t14-uncertain-delivery" } })
  assert(result.kind === "uncertain" && result.code === "idempotency_uncertain", `wrong restart state: ${JSON.stringify(result)}`)
  const messages = await client.messages(opened.routingId)
  const deliveredCount = countUserTurns(messages, "t14-uncertain-delivery")
  assert(deliveredCount === 1, `host get_messages delivered_count=${deliveredCount}`)
  console.log(`assert uncertain-operation child_sigkill=true state=idempotency_uncertain host_get_messages=true delivered_count=${deliveredCount} auto_redelivered=false`)
  console.log("PASS uncertain-operation")
} finally {
  try { if (sender?.pid) process.kill(sender.pid, "SIGKILL") } catch {}
  try { host?.child?.kill("SIGKILL") } catch {}
  try { await fake?.stop() } catch {}
  await cleanupAllAndWait().catch(() => undefined)
  try { qa?.cleanup?.() } catch {}
  if (qa?.dir) rmSync(qa.dir, { recursive: true, force: true })
  cleanupReceipt("uncertain-operation", qa?.dir ?? "missing", before, [sender?.pid, host?.pid].filter(Boolean))
}
