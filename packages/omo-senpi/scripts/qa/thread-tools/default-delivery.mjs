#!/usr/bin/env bun
/**
 * default-delivery (#14333): a session on a shard host sends to a real pty TUI through the thread_send TOOL with no
 * delivery mode, and once with an explicit follow_up.
 *
 * 1. Idle TUI, no mode: the delivery starts a turn there (`started`), recorded as requested `auto`, effective `start`:
 *    the tool result, the row and the header the TUI's model reads all say start, never follow_up.
 * 2. TUI mid-turn (its answer held open), no mode: the delivery is steered into the running turn (`steered`),
 *    recorded as requested `auto`, effective `steer`, inside that turn.
 * 3. TUI mid-turn, explicit follow_up: the delivery waits behind the running turn (never `steered`) and is answered
 *    only after that turn's answer, recorded and reported as effective `follow_up`.
 */
import {
  assistantTexts,
  awaitToolResult,
  awaitTuiEndpoint,
  callDirective,
  deliveryEntries,
  deliveryIdOf,
  deliveryRow,
  holdDirective,
  openHostSession,
  runScenario,
  startShardHost,
  waitFor,
} from "./lib/gateway.mjs"
import { parseDeliveryText } from "./lib/delivery-text.mjs"

function entryText(entry) {
  const content = entry?.message?.content ?? entry?.content
  if (typeof content === "string") return content
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : ""
}

await runScenario("default-delivery", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.submit("/name tui-target")

  const shard = await startShardHost(scratch, install, `qa-default-delivery-${process.pid}`)
  const hostSession = await openHostSession(shard.client, scratch.work)

  const hostSend = async (token, extra = {}) => {
    const mark = fake.requests.length
    const prompted = await shard.client.request({
      type: "prompt",
      sessionId: hostSession.routingId,
      message: callDirective("thread_send", { thread: target.durableId, message: `${token} from the host`, ...extra }),
    })
    if (prompted.success !== true) throw new Error(`host prompt failed: ${JSON.stringify(prompted)}`)
    return await awaitToolResult(fake, "thread_send", mark, { label: `host thread_send ${token}` })
  }
  const admitted = async (id) =>
    await waitFor(
      async () => {
        const row = await deliveryRow(scratch.agentDir, id)
        return row?.admission_kind ? row : undefined
      },
      { label: `admission of ${id}` },
    )
  const answered = (needle) =>
    waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(needle)), {
      label: `tui answers ${needle}`,
    })
  const answerIndex = (needle) => assistantTexts(target.sessionPath).findIndex((text) => text.includes(needle))
  // The header the TUI's session recorded for a delivery: the text its model reads, parsed as a receiver parses it.
  const headerOf = (deliveryId) => {
    const text = entryText(deliveryEntries(target.sessionPath).find((entry) => deliveryIdOf(entry) === deliveryId))
    return { parsed: parseDeliveryText(text)?.header, line: text.split("\n")[0] ?? "" }
  }

  // 1. idle, no mode
  const idle = await hostSend("QA-TOKEN-idle")
  const idleRow = await admitted(idle.delivery_id)
  await answered("QA-ACK QA-TOKEN-idle")
  report.assert(
    "idle-no-mode-starts",
    idle.kind === "ok" && idleRow.admission_kind === "started" && idleRow.mode_requested === "auto",
    `result=${JSON.stringify(idle).slice(0, 200)} admission=${idleRow.admission_kind} requested=${idleRow.mode_requested}`,
  )
  const idleHeader = headerOf(idle.delivery_id)
  report.assert(
    "idle-reports-effective-start",
    idle.effective_mode === "start" && idleRow.mode_effective === "start" && idleHeader.parsed?.effective === "start",
    `result.effective_mode=${idle.effective_mode} row.mode_effective=${idleRow.mode_effective} header.effective=${idleHeader.parsed?.effective} line=${idleHeader.line.slice(-220)}`,
  )

  // 2. mid-turn, no mode
  await tui.submit(`${holdDirective("busy-1")} QA-TOKEN-busy-1`)
  await waitFor(() => fake.heldTags().includes("busy-1"), { label: "tui turn streaming" })
  const steer = await hostSend("QA-TOKEN-steer")
  const steerRow = await admitted(steer.delivery_id)
  report.assert(
    "busy-no-mode-steers",
    steerRow.admission_kind === "steered" && steerRow.mode_requested === "auto" && steerRow.mode_effective === "steer",
    `admission=${steerRow.admission_kind} requested=${steerRow.mode_requested} effective=${steerRow.mode_effective}`,
  )
  report.assert("release-busy-1", fake.release("busy-1"), "held turn released")
  await answered("QA-ACK QA-TOKEN-steer")
  // The steered turn has settled only when its delivery is applied, both its answers are written and the TUI itself
  // reports no running turn and nothing pending; a prompt submitted before that is taken as a steer, not a new turn.
  const settledState = await waitFor(
    async () => {
      const row = await deliveryRow(scratch.agentDir, steer.delivery_id)
      if (row?.state !== "applied") return undefined
      const texts = assistantTexts(target.sessionPath)
      if (!texts.some((text) => text.includes("QA-RELEASED busy-1"))) return undefined
      const state = (await target.client.request({ type: "get_state" })).data
      return state?.isStreaming === false && (state.pendingMessageCount ?? 0) === 0 ? state : undefined
    },
    { label: "steered turn settled (row applied, busy-1 answered, tui idle)" },
  )
  report.assert(
    "steered-turn-settled",
    settledState.isStreaming === false,
    `isStreaming=${settledState.isStreaming} pending=${settledState.pendingMessageCount ?? 0}`,
  )

  // 3. mid-turn, explicit follow_up
  await tui.submit(`${holdDirective("busy-2")} QA-TOKEN-busy-2`)
  await waitFor(() => fake.heldTags().includes("busy-2"), { label: "tui turn streaming again" })
  const queued = await hostSend("QA-TOKEN-follow", { delivery: "follow_up" })
  const queuedRow = await admitted(queued.delivery_id)
  report.assert(
    "busy-follow-up-waits",
    queuedRow.admission_kind === "queued" &&
      queuedRow.mode_requested === "follow_up" &&
      queuedRow.mode_effective === "follow_up" &&
      queued.effective_mode === "follow_up",
    `admission=${queuedRow.admission_kind} requested=${queuedRow.mode_requested} effective=${queuedRow.mode_effective}`,
  )
  report.assert("release-busy-2", fake.release("busy-2"), "held turn released")
  await answered("QA-ACK QA-TOKEN-follow")
  await answered("QA-RELEASED busy-2")
  report.assert(
    "follow-up-answered-after-the-turn",
    answerIndex("QA-RELEASED busy-2") < answerIndex("QA-ACK QA-TOKEN-follow"),
    `released_at=${answerIndex("QA-RELEASED busy-2")} follow_up_answer_at=${answerIndex("QA-ACK QA-TOKEN-follow")}`,
  )
})
