#!/usr/bin/env bun
/**
 * lost-ack (todo 16, IS-6 "never claim exactly-once after a lost ACK"): the sender dies between
 * admission into the store and its reply. `omo thread send --idempotency-key K` runs with the store
 * worker's `afterDbCommit` hook armed (patch `sender_kill_after_commit`,
 * `THREAD_QA_AFTER_DB_COMMIT=sigkill`), so the CLI is SIGKILLed the instant its delivery COMMIT
 * returned and never answers. The target is a live pty TUI holding a draft, so the row stays
 * undelivered. A retry with the same key is `idempotency_uncertain` (naming the first `delivery_id`
 * and its row state) and adds no row. When the user clears the draft the one delivery is applied
 * once, and a retry after that still sends nothing twice.
 */
import { assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, runScenario, storeRows, waitFor } from "./lib/gateway.mjs"

const TOKEN = "QA-TOKEN-lost-ack"
const KEY = "qa-lost-ack-1"
const DRAFT = "typing while a message is in flight"

await runScenario("lost-ack", async ({ report, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  await tui.type(DRAFT)
  const text = `${TOKEN} whose acknowledgement is lost`
  const rowsFor = () => storeRows(scratch.agentDir, "SELECT delivery_id, state FROM deliveries WHERE target_durable_id = ? AND body LIKE ?", [target.durableId, `%${TOKEN}%`])

  const lost = await cliSend(scratch, install, target.durableId, text, ["--idempotency-key", KEY], { env: { THREAD_QA_AFTER_DB_COMMIT: "sigkill" } })
  const [committed] = await rowsFor()
  const [receipt] = await storeRows(scratch.agentDir, "SELECT status, delivery_id FROM receipts WHERE idempotency_key = ?", [KEY])
  report.assert(
    "sender-killed-after-commit-before-reply",
    lost.code !== 0 && lost.stdout.trim() === "" && committed?.state === "queued" && receipt?.status === "prepared" && receipt.delivery_id === committed.delivery_id,
    `exit=${lost.code} stdout=${JSON.stringify(lost.stdout.slice(0, 120))} row=${JSON.stringify(committed)} receipt=${JSON.stringify(receipt)}`,
  )

  const retry = await cliSend(scratch, install, target.durableId, text, ["--idempotency-key", KEY])
  const error = retry.json?.error
  report.assert(
    "retry-idempotency-uncertain",
    retry.code === 1 && error?.code === "idempotency_uncertain" && error.details?.delivery_id === committed?.delivery_id && error.details?.state === "queued",
    `exit=${retry.code} ${retry.stdout.trim().slice(0, 300)}`,
  )
  report.assert("retry-adds-no-row", (await rowsFor()).length === 1, JSON.stringify(await rowsFor()))

  for (let index = 0; index < DRAFT.length; index += 1) tui.press("backspace")
  await waitFor(() => assistantTexts(target.sessionPath).some((line) => line.includes(`QA-ACK ${TOKEN}`)), { label: "the one delivery answered after the draft is cleared" })
  const row = await waitFor(async () => {
    const current = await deliveryRow(scratch.agentDir, committed.delivery_id)
    return current?.state === "applied" ? current : undefined
  }, { label: "row applied" })
  const again = await cliSend(scratch, install, target.durableId, text, ["--idempotency-key", KEY])
  const entries = deliveryEntries(target.sessionPath).filter((entry) => deliveryIdOf(entry) === committed.delivery_id).length
  const answers = assistantTexts(target.sessionPath).filter((line) => line.includes(`QA-ACK ${TOKEN}`)).length
  const finalRows = await rowsFor()
  report.assert(
    "no-duplicate-transcript-entry",
    entries === 1 && answers === 1 && finalRows.length === 1 && again.json?.kind === "error" && again.json.error?.code === "idempotency_uncertain",
    `entries=${entries} answers=${answers} rows=${finalRows.length} admission_kind=${row.admission_kind} retry_after_apply=${again.stdout.trim().slice(0, 200)}`,
  )
}, { patches: ["gateway_send", "sender_kill_after_commit"] })
