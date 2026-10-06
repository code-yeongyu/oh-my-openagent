#!/usr/bin/env bun
/**
 * host-to-tui (todo 16, IS-6 "never interrupt what the receiving user is typing"): a session on a
 * Desktop-thread shard host (`i-*`, ensured from omo's launch spec) sends to a real pty TUI.
 *
 * 1. Draft hold: the TUI's user has typed a draft (no Enter). The delivery is NOT admitted: the row
 *    stays queued, the transcript has no entry, the editor text is byte-identical, and the one-line
 *    notice `remote message from <actor> queued (<delivery_id>)` is on screen.
 * 2. Enter drains: the user submits the draft; their turn runs first, then the held delivery is
 *    admitted once and answered, with no further input.
 * 3. Idle: a second host delivery to the now idle TUI starts a turn (`started`) with no keystroke.
 */
import { assistantTexts, awaitToolResult, awaitTuiEndpoint, callDirective, deliveryEntries, deliveryIdOf, deliveryRow, openHostSession, runScenario, sessionEntries, startShardHost, waitFor } from "./lib/gateway.mjs"

const DRAFT = "keep this draft QA-TOKEN-draft"

function transcriptIndex(path, predicate) {
  return sessionEntries(path).findIndex(predicate)
}

await runScenario("host-to-tui", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.submit("/name tui-target")

  const shard = await startShardHost(scratch, install, `qa-host-to-tui-${process.pid}`)
  report.assert("shard-is-i-endpoint", /\/i-[0-9a-f]{16}\.sock$/.test(shard.socket), shard.socket)
  const hostSession = await openHostSession(shard.client, scratch.work)
  report.log(`host session routing=${hostSession.routingId} durable=${hostSession.durableId} tui=${target.durableId}`)

  const hostSend = async (token) => {
    const mark = fake.requests.length
    const prompted = await shard.client.request({ type: "prompt", sessionId: hostSession.routingId, message: callDirective("thread_send", { thread: target.durableId, message: `${token} from the shard host` }) })
    if (prompted.success !== true) throw new Error(`host prompt failed: ${JSON.stringify(prompted)}`)
    return await awaitToolResult(fake, "thread_send", mark, { label: `host thread_send ${token}` })
  }

  // 1. draft hold
  await tui.type(DRAFT)
  const editorBefore = tui.editorText()
  const held = await hostSend("QA-TOKEN-held")
  report.assert("held-send-accepted", held?.kind === "ok" && typeof held.delivery_id === "string", JSON.stringify(held).slice(0, 300))
  const heldId = held.delivery_id
  const notice = `remote message from ${hostSession.durableId} queued (${heldId})`
  const flat = (text) => text.replace(/\s+/g, "")
  await tui.waitScreen((text) => flat(text).includes(flat(notice)), { label: "queued notice visible", scope: "history" })
  report.assert("held-notice-visible", true, notice)
  const heldRow = await deliveryRow(scratch.agentDir, heldId)
  report.assert("held-row-still-queued", heldRow?.state === "queued" && heldRow.admission_kind === null, `state=${heldRow?.state} admission_kind=${heldRow?.admission_kind}`)
  report.assert("held-no-transcript-entry", deliveryEntries(target.sessionPath).every((entry) => deliveryIdOf(entry) !== heldId), `entries=${deliveryEntries(target.sessionPath).length}`)
  report.assert("held-draft-untouched", tui.editorText() === editorBefore && editorBefore === DRAFT, `before=${JSON.stringify(editorBefore)} after=${JSON.stringify(tui.editorText())}`)

  // 2. Enter drains: the draft is the user's turn, the delivery follows it with no more input
  tui.press("enter")
  const keystrokesAfterEnter = tui.keystrokes
  await waitFor(() => deliveryEntries(target.sessionPath).some((entry) => deliveryIdOf(entry) === heldId), { label: "held delivery admitted after Enter" })
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-held")), { label: "tui answers the held delivery" })
  const userIndex = transcriptIndex(target.sessionPath, (entry) => entry.message?.role === "user" && JSON.stringify(entry.message.content).includes("QA-TOKEN-draft"))
  const deliveryIndex = transcriptIndex(target.sessionPath, (entry) => deliveryIdOf(entry) === heldId)
  // The draft's turn finished first: its answer precedes the delivery, so the delivery was not steered into it.
  const draftAnswerIndex = transcriptIndex(target.sessionPath, (entry) => entry.message?.role === "assistant" && JSON.stringify(entry.message.content).includes("QA-ACK QA-TOKEN-draft"))
  report.assert(
    "draft-turn-before-delivery",
    userIndex >= 0 && draftAnswerIndex > userIndex && deliveryIndex > draftAnswerIndex,
    `user_entry=${userIndex} draft_answer_entry=${draftAnswerIndex} delivery_entry=${deliveryIndex}`,
  )
  const drained = await waitFor(async () => {
    const row = await deliveryRow(scratch.agentDir, heldId)
    return row?.state === "applied" ? row : undefined
  }, { label: "held row applied" })
  report.assert("held-applied-once", deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === heldId).length === 1 && tui.keystrokes === keystrokesAfterEnter, `admission_kind=${drained.admission_kind} extra_keystrokes=${tui.keystrokes - keystrokesAfterEnter}`)

  // 3. idle target: started with no input
  const keystrokesBeforeIdle = tui.keystrokes
  const idle = await hostSend("QA-TOKEN-idle")
  const idleId = idle?.delivery_id
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes("QA-ACK QA-TOKEN-idle")), { label: "idle tui answers" })
  const idleRow = await waitFor(async () => {
    const row = await deliveryRow(scratch.agentDir, idleId)
    return row?.state === "applied" ? row : undefined
  }, { label: "idle row applied" })
  report.assert("idle-started-without-input", idleRow.admission_kind === "started" && tui.keystrokes === keystrokesBeforeIdle, `admission_kind=${idleRow.admission_kind} keystrokes=${tui.keystrokes - keystrokesBeforeIdle}`)
  report.assert("idle-single-entry", deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === idleId).length === 1, `delivery_id=${idleId}`)
  const envelope = JSON.parse(idleRow.envelope)
  report.assert("sender-is-host-session", envelope.origin?.session === hostSession.durableId, `origin=${JSON.stringify(envelope.origin)}`)
})
