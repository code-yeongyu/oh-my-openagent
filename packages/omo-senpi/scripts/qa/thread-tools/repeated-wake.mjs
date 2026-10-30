#!/usr/bin/env bun
/**
 * repeated-wake (todo 16, IS-6 exactly-one-entry): the target TUI is mid-turn on a held (streaming)
 * fake-model answer. One `omo thread send` queues a delivery behind the turn; three more direct
 * `wake { delivery_ids }` commands hit the terminal's control endpoint while it streams. Releasing
 * the stream lets the queued delivery run. Every wake pass is answered, and the transcript holds
 * exactly ONE entry for the `delivery_id`, answered once.
 */
import { assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, holdDirective, runScenario, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-repeated-wake"

await runScenario("repeated-wake", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)

  await tui.submit(holdDirective("rw"))
  await waitFor(() => fake.heldTags().includes("rw"), { label: "model stream held open" })
  await tui.waitScreen("QA-STREAMING rw", { label: "turn visibly streaming", scope: "history" })
  const streaming = await target.client.request({ type: "get_state" })
  report.assert("target-streaming", streaming.data?.isStreaming === true, `isStreaming=${streaming.data?.isStreaming}`)

  const sent = await cliSend(scratch, install, target.durableId, `${TOKEN} queued behind the running turn`)
  const deliveryId = sent.json?.delivery_id
  report.assert("send-queued-behind-turn", sent.code === 0 && sent.json?.kind === "ok" && typeof deliveryId === "string", `exit=${sent.code} ${sent.stdout.trim().slice(0, 300)}`)

  const wakes = []
  for (let index = 0; index < 3; index += 1) {
    const woke = await target.client.request({ type: "wake", delivery_ids: [deliveryId] })
    wakes.push(woke.data ?? woke.error)
    report.assert(`wake-${index + 1}-answered`, woke.success === true && Array.isArray(woke.data?.admitted), JSON.stringify(woke.data ?? woke.error))
  }
  const midTurnRow = await deliveryRow(scratch.agentDir, deliveryId)
  report.assert("no-entry-while-streaming", deliveryEntries(target.sessionPath).every((entry) => deliveryIdOf(entry) !== deliveryId), `row_state=${midTurnRow?.state} admission_kind=${midTurnRow?.admission_kind}`)

  report.assert("release-hold", fake.release("rw"), "stream released")
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes(`QA-ACK ${TOKEN}`)), { label: "queued delivery answered after the turn" })
  const row = await waitFor(async () => {
    const current = await deliveryRow(scratch.agentDir, deliveryId)
    return current?.state === "applied" ? current : undefined
  }, { label: "row applied" })
  const entries = deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId)
  const answered = assistantTexts(target.sessionPath).filter((text) => text.includes(`QA-ACK ${TOKEN}`)).length
  report.assert("exactly-one-entry-per-delivery", entries.length === 1 && answered === 1, `entries=${entries.length} answers=${answered} admission_kind=${row.admission_kind} attempt=${row.attempt} wakes=${JSON.stringify(wakes)}`)
})
