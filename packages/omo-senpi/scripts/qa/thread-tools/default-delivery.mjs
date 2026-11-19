#!/usr/bin/env bun
/**
 * default-delivery (#14333): a session on a shard host sends to a real pty TUI through the thread_send TOOL with no
 * delivery mode, and once with an explicit follow_up.
 *
 * 1. Idle TUI, no mode: the delivery starts a turn there (`started`), recorded as requested `auto`.
 * 2. TUI mid-turn (its answer held open), no mode: the delivery is steered into the running turn (`steered`),
 *    recorded as requested `auto`, effective `steer`, and answered before the held turn is released.
 * 3. TUI mid-turn, explicit follow_up: the delivery waits behind the running turn (never `steered`) and is answered
 *    only after that turn's answer.
 */
import {
  assistantTexts,
  awaitToolResult,
  awaitTuiEndpoint,
  callDirective,
  deliveryRow,
  holdDirective,
  openHostSession,
  runScenario,
  startShardHost,
  waitFor,
} from "./lib/gateway.mjs"

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

  // 1. idle, no mode
  const idle = await hostSend("QA-TOKEN-idle")
  const idleRow = await admitted(idle.delivery_id)
  await answered("QA-ACK QA-TOKEN-idle")
  report.assert(
    "idle-no-mode-starts",
    idle.kind === "ok" && idleRow.admission_kind === "started" && idleRow.mode_requested === "auto",
    `result=${JSON.stringify(idle).slice(0, 200)} admission=${idleRow.admission_kind} requested=${idleRow.mode_requested}`,
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

  // 3. mid-turn, explicit follow_up
  await tui.submit(`${holdDirective("busy-2")} QA-TOKEN-busy-2`)
  await waitFor(() => fake.heldTags().includes("busy-2"), { label: "tui turn streaming again" })
  const queued = await hostSend("QA-TOKEN-follow", { delivery: "follow_up" })
  const queuedRow = await admitted(queued.delivery_id)
  report.assert(
    "busy-follow-up-waits",
    queuedRow.admission_kind !== "steered" && queuedRow.mode_requested === "follow_up",
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
