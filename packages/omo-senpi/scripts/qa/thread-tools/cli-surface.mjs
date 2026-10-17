#!/usr/bin/env bun
/**
 * (a) CLI surface: over the host socket a terminal client speaks, the thread tools create,
 * send to, and steer a PEER session. (The interactive caller used to be hosted in that same
 * socket host through `createInteractiveHostRuntime`; senpi e76e4faaf6 removed the shared-host
 * proxy runtime, so a TUI always owns its local session and the TUI path is covered by the
 * gateway suite's tui-to-tui instead.)
 *
 * What makes this a real proof rather than a log read: every assertion is taken from
 * the peer's own transcript via the host's `get_messages`, and address resolution runs
 * through the shipped addressing/address-book components against the host's live
 * `list_sessions` - not through a fixture.
 *
 * Failure path: thread_send addressed at an unknown target resolves to the typed
 * `not_found` failure, and the script still tears everything down.
 */
import { join } from "node:path"

import {
  HostClient,
  cleanupAllAndWait,
  countUserTurns,
  createReport,
  flag,
  installCleanupHooks,
  liveAddressBook,
  deliverAuto,
  deliveryPortFor,
  makeScratch,
  messageText,
  startFakeModelServer,
  startRealHost,
  threadComponent,
  verifyCleanup,
  writeMockModelsJson,
} from "./lib/harness.mjs"

const CREATE_NEEDLE = "t13a-created-peer-needle"
const SEND_NEEDLE = "t13a-ordered-send-needle"
const STEER_NEEDLE = "t13a-steer-needle"

const report = createReport("cli-surface")
installCleanupHooks()

let scratchDir
let socketPath
try {
  const scratch = makeScratch("t13-cli-surface")
  scratchDir = scratch.dir
  const fake = await startFakeModelServer([
    { text: "peer-created-ack" },
    { text: "peer-send-ack" },
    { hold: true },
    { text: "peer-steer-ack" },
    { text: "peer-idle-ack" },
  ])
  writeMockModelsJson(scratch.agentDir, fake)
  const host = await startRealHost(scratch, { extraArgs: ["--provider", "mock", "--model", "mock-model"] })
  socketPath = host.socket
  report.log(`host pid=${host.pid} socket=${host.socket}`)

  // The tool-calling side speaks the same wire the tools use.
  const tools = await HostClient.connect(host.socket, "tools")

  // ---- thread_create: the caller opens a peer session in the same host ----
  const peerCwd = join(scratch.dir, "peer-project")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(peerCwd, { recursive: true })
  const peer = await tools.openSession({ cwd: peerCwd, sessionPath: join(scratch.sessionDir, "peer.jsonl") })
  await tools.request({ type: "set_session_name", sessionId: peer.routingId, name: "cli-peer" })
  report.log(`peer routing=${peer.routingId} durable=${peer.state.sessionId}`)

  await tools.promptAndSettle(peer.routingId, CREATE_NEEDLE)
  const afterCreate = await tools.messages(peer.routingId)
  report.assert(
    "create-transcript",
    countUserTurns(afterCreate, CREATE_NEEDLE) === 1 &&
      afterCreate.some((message) => message.role === "assistant" && messageText(message).includes("peer-created-ack")),
    `user_turns=${countUserTurns(afterCreate, CREATE_NEEDLE)} roles=${JSON.stringify(afterCreate.map((m) => m.role))}`,
  )

  // ---- addressing: resolve the peer by NAME through the shipped components ----
  const { addressEntries, entries } = await liveAddressBook(tools, host.socket, scratch.sessionDir)
  const { resolveTarget } = await threadComponent("addressing")
  const resolved = resolveTarget(addressEntries, "cli-peer", { all_scope: true })
  report.assert(
    "address-book-resolves-peer",
    resolved.kind === "ok" && resolved.entry.thread_id === peer.state.sessionId,
    `resolution=${resolved.kind === "ok" ? resolved.resolution : JSON.stringify(resolved)} entries=${entries.length}`,
  )

  // ---- thread_send: one auto delivery over the CLI transport, asserted in the transcript ----
  const sendResult = await deliverAuto(deliveryPortFor(tools, peer.routingId), SEND_NEEDLE)
  const afterSend = await tools.messages(peer.routingId)
  report.assert(
    "send-transcript",
    sendResult.kind === "ok" && countUserTurns(afterSend, SEND_NEEDLE) === 1,
    `delivery=${sendResult.kind === "ok" ? sendResult.delivery : JSON.stringify(sendResult)} user_turns=${countUserTurns(afterSend, SEND_NEEDLE)}`,
  )

  // ---- thread_send delivery=steer: land a message inside the peer's ACTIVE turn ----
  const turnMark = tools.mark()
  await tools.request({ type: "prompt", sessionId: peer.routingId, message: "t13a-held-turn" })
  await tools.waitFor((record) => record.type === "agent_start" && record.sessionId === peer.routingId, turnMark, 60_000)
  await tools.request({ type: "steer", sessionId: peer.routingId, message: STEER_NEEDLE })
  fake.releaseHolds()
  await tools.waitFor(
    (record) => record.type === "agent_settled" && record.sessionId === peer.routingId,
    turnMark,
    120_000,
  )
  // The steered message runs as its own turn after the held one settles; wait for that turn too.
  await tools.waitFor(
    (record) => record.type === "agent_settled" && record.sessionId === peer.routingId,
    turnMark + 1,
    120_000,
  )
  const afterSteer = await tools.messages(peer.routingId)
  report.assert(
    "steer-transcript",
    countUserTurns(afterSteer, STEER_NEEDLE) === 1,
    `user_turns=${countUserTurns(afterSteer, STEER_NEEDLE)} roles=${JSON.stringify(afterSteer.map((m) => m.role))}`,
  )

  // ---- typed error path: unknown target ----
  const unknownResolution = resolveTarget(addressEntries, "no-such-thread-t13a", { all_scope: true })
  const unknownWire = await tools.raw({ type: "steer", sessionId: "rpc-unknown-t13a", message: "should not land" })
  const beforeUnknown = afterSteer.length
  const afterUnknown = await tools.messages(peer.routingId)
  report.assert(
    "unknown-target-typed-error",
    unknownResolution.kind === "error" &&
      unknownResolution.code === "not_found" &&
      unknownWire.success === false &&
      unknownWire.error === "unknown_session" &&
      afterUnknown.length === beforeUnknown,
    `tool_code=${unknownResolution.kind === "error" ? unknownResolution.code : "none"} wire_error=${unknownWire.error} transcript_unchanged=${afterUnknown.length === beforeUnknown}`,
  )

  // ---- transcript reader over the peer's durable session file ----
  const { readTranscript } = await threadComponent("reader")
  const read = readTranscript(
    { kind: "session_jsonl", path: join(scratch.sessionDir, "peer.jsonl") },
    { mode: "tail", items: 20 },
  )
  report.assert(
    "reader-sees-peer-turns",
    read.kind === "ok" && JSON.stringify(read.items).includes(STEER_NEEDLE),
    `reader_kind=${read.kind} items=${read.kind === "ok" ? read.items.length : 0}`,
  )

  await tools.request({ type: "close_session", sessionId: peer.routingId })
  await fake.stop()
} catch (error) {
  report.log(`FAIL cli-surface harness error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exitCode = 1
} finally {
  await cleanupAllAndWait()
  verifyCleanup(report, { scratchDir, socketPaths: socketPath === undefined ? [] : [socketPath] })
  const verdict = report.failures === 0 && process.exitCode !== 1
  report.log(`${verdict ? "PASS" : "FAIL"} cli-surface assertions_failed=${report.failures}`)
  report.write(flag("--out"))
  // Exit explicitly: the interactive host runtime and the fake model keep handles that
  // would otherwise hold the loop open after every resource has been released.
  process.exit(verdict ? 0 : 1)
}
