#!/usr/bin/env bun
/**
 * busy-backlog (#14428): a real pty TUI held mid-turn takes follow-ups into its own queue without writing them, so they
 * fill the target's backlog. From a scratch install, through the real CLI and the thread SDK:
 * 1. A collapse key repeated 5 times leaves one undelivered message (the TUI holds the first; the rest are absorbed).
 * 2. 127 more follow-ups from 16 SDK senders (inside each sender's pair burst) are taken into the busy TUI's queue.
 * 3. One more follow-up is refused queue_full, naming 128 held by the session, the oldest age and the reason.
 * 4. A steer at the running turn is still admitted (steered), not refused by the full follow-up lane.
 * 5. `omo thread list` shows the target running, with its backlog.
 * 6. On release the TUI writes the steer, then every follow-up in the order it was queued, and the backlog drains.
 */
import { createThreadSdk } from "../../../src/components/thread/sdk.ts"
import {
  awaitTuiEndpoint,
  cliSend,
  deliveryEntries,
  deliveryIdOf,
  holdDirective,
  omo,
  runScenario,
  storeRows,
  waitFor,
} from "./lib/gateway.mjs"

const SENDERS = 16
const PER_SENDER = 8

await runScenario("busy-backlog", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("busy-seat")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.submit(`${holdDirective("seat")} QA-TOKEN-seat-busy`)
  await waitFor(() => fake.heldTags().includes("seat"), { label: "seat turn streaming" })
  const open = async () =>
    await storeRows(
      scratch.agentDir,
      "SELECT delivery_id, state, admission_kind, turn_epoch, body, seq FROM deliveries WHERE target_durable_id = ? AND state IN ('queued', 'admitting', 'admitted') ORDER BY seq",
      [target.durableId],
    )

  // 1. collapse key
  const collapsed = []
  for (let index = 0; index < 5; index++)
    collapsed.push(
      await cliSend(scratch, install, target.durableId, `QA-TOKEN-alert unanswered for ${index * 3} min`, [
        "--mode",
        "follow_up",
        "--collapse-key",
        "qa-alert-1",
      ]),
    )
  const afterCollapse = await waitFor(
    async () => {
      const rows = await open()
      return rows.length === 1 && rows[0].state === "admitted" ? rows : undefined
    },
    { label: "the first alert taken into the busy seat's queue" },
  )
  report.assert(
    "collapse-key-leaves-one-undelivered",
    collapsed.every((sent) => sent.json?.kind === "ok") &&
      collapsed
        .slice(1)
        .every(
          (sent) => sent.json?.deduplicated === true && sent.json?.delivery_id === collapsed[0].json?.delivery_id,
        ) &&
      afterCollapse.length === 1,
    `results=${JSON.stringify(collapsed.map((sent) => [sent.code, sent.json?.kind, sent.json?.deduplicated, sent.json?.delivery_id]))} open=${afterCollapse.length}`,
  )

  // 2. fill the follow-up lane from 16 senders
  const sdks = Array.from({ length: SENDERS }, (_, index) =>
    createThreadSdk({
      agentDir: scratch.agentDir,
      cwd: scratch.work,
      uid: 60_000 + index,
      user: `qa-${index}`,
      env: scratch.env,
    }),
  )
  const fills = []
  for (let index = 0; index < SENDERS * PER_SENDER - 1; index++)
    fills.push(
      await sdks[index % SENDERS].send({
        thread: target.durableId,
        text: `QA-TOKEN-fill-${String(index).padStart(3, "0")}`,
        mode: "follow_up",
      }),
    )
  const full = await waitFor(
    async () => {
      const rows = await open()
      return rows.length === 128 && rows.every((row) => row.state === "admitted") ? rows : undefined
    },
    { label: "128 follow-ups held by the busy seat", timeoutMs: 120_000 },
  )
  report.assert(
    "busy-seat-holds-128-follow-ups",
    fills.every((sent) => sent.kind === "ok") && full.every((row) => row.admission_kind === "queued"),
    `refused=${fills.filter((sent) => sent.kind !== "ok").length} kinds=${[...new Set(full.map((row) => row.admission_kind))]}`,
  )

  // 3. queue_full details
  const refused = await cliSend(scratch, install, target.durableId, "QA-TOKEN-one-too-many", ["--mode", "follow_up"])
  const details = refused.json?.error?.details ?? {}
  report.assert(
    "queue-full-names-why",
    refused.json?.error?.code === "queue_full" &&
      details.lane === "follow_up" &&
      details.held === 128 &&
      details.held_by_session === 128 &&
      details.waiting_in_gateway === 0 &&
      details.reason === "session_not_writing" &&
      Number(details.oldest_age_ms) > 0,
    `code=${refused.code} error=${JSON.stringify(refused.json?.error ?? refused.stderr.slice(-300))}`,
  )

  // 4. steer at the running turn
  const steer = await cliSend(scratch, install, target.durableId, "QA-TOKEN-steer read this now", [
    "--mode",
    "steer",
    "--expected-turn",
    String(full[0].turn_epoch),
  ])
  report.assert(
    "steer-admitted-with-full-follow-up-lane",
    steer.json?.kind === "ok" && steer.json?.delivery?.kind === "steered",
    `code=${steer.code} result=${JSON.stringify(steer.json ?? steer.stderr.slice(-300)).slice(0, 300)}`,
  )

  // 5. thread_list backlog
  const listed = await omo(scratch, install, ["thread", "list", "--json"])
  const row = (listed.json?.threads ?? []).find((thread) => thread.thread === target.durableId)
  report.assert(
    "thread-list-shows-backlog",
    row?.backlog?.held === 129 && row.backlog.held_by_session === 129 && typeof row.backlog.oldest_at === "string",
    `code=${listed.code} row=${JSON.stringify(row ?? null).slice(0, 400)}`,
  )
  report.assert(
    "thread-list-running-while-turn-held",
    row?.state === "running",
    `state=${row?.state} activity=${row?.activity}`,
  )

  // 6. release: the steer first, then the follow-ups in queue order
  report.assert("release-seat", fake.release("seat"), "held turn released")
  const drained = await waitFor(async () => ((await open()).length === 0 ? true : undefined), {
    label: "backlog drained",
    timeoutMs: 300_000,
  })
  const written = deliveryEntries(target.sessionPath).map(deliveryIdOf)
  const queuedOrder = [steer.json?.delivery_id, ...full.map((held) => held.delivery_id)]
  report.assert(
    "steer-then-follow-ups-in-order",
    drained === true &&
      JSON.stringify(written.filter((id) => queuedOrder.includes(id))) === JSON.stringify(queuedOrder),
    `written=${written.length} first=${written.slice(0, 3)} expected-first=${queuedOrder.slice(0, 3)}`,
  )
  for (const sdk of sdks) await sdk.dispose?.()
})
