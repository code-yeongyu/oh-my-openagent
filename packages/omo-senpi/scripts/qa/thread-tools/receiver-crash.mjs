#!/usr/bin/env bun
/**
 * receiver-crash (todo 16, IS-6): the receiving pty TUI is SIGKILLed by the drain's `afterAdmit`
 * seam (patch `crash_after_admit`, armed by `THREAD_QA_CRASH_AFTER_ADMIT=started`) right after
 * `admitExternalMessage` answered `started` and before T2 records the outcome. Two cases: a session
 * with prior assistant messages, and a fresh session whose file holds only its persisted header.
 * Restarting through the real CLI (`omo --session <path>`, seam disarmed) keeps the same durable id
 * (`omo thread list --json`), leaves exactly one entry for the `delivery_id` on disk, and never
 * admits it a second time (no second model turn for it).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { awaitTuiEndpoint, cliSend, deliveryEntries, deliveryIdOf, deliveryRow, omo, runScenario, sessionEntries, waitFor } from "./lib/gateway.mjs"

await runScenario("receiver-crash", async ({ report, fake, scratch, install, startTui }) => {
  for (const kind of ["with-history", "header-only"]) {
    const marker = join(scratch.dir, `crash-${kind}.marker`)
    const tui = await startTui(`tui-${kind}`, { env: { THREAD_QA_CRASH_AFTER_ADMIT: "started", THREAD_QA_CRASH_MARKER: marker } })
    const endpoint = await awaitTuiEndpoint(scratch, tui, { exclude: registrySockets(scratch) })
    if (kind === "with-history") {
      await tui.submit(`prior turn QA-TOKEN-prior-${kind}`)
      await waitFor(() => sessionEntries(endpoint.sessionPath).some((entry) => entry.message?.role === "assistant" && JSON.stringify(entry.message.content).includes("QA-ACK")), { label: "prior turn answered" })
    } else {
      const entries = sessionEntries(endpoint.sessionPath)
      report.assert(`${kind}-file-holds-no-messages`, entries[0]?.type === "session" && !entries.some((entry) => entry.type === "message"), `entries=${entries.map((entry) => entry.type).join(",")}`)
    }
    const token = `QA-TOKEN-crash-${kind}`
    const sent = await cliSend(scratch, install, endpoint.durableId, `${token} delivered into a receiver that crashes`)
    const deliveryId = sent.json?.delivery_id
    report.assert(`${kind}-send-ok`, sent.json?.kind === "ok" && typeof deliveryId === "string", sent.stdout.trim().slice(0, 300))
    const exitCode = await tui.exited
    const crashedFor = existsSync(marker) ? readFileSync(marker, "utf8") : ""
    report.assert(`${kind}-receiver-killed-after-started`, crashedFor === deliveryId && exitCode !== 0, `marker=${crashedFor} exit=${exitCode}`)
    const afterCrash = await deliveryRow(scratch.agentDir, deliveryId)
    report.log(`${kind} row after crash: state=${afterCrash?.state} admission_kind=${afterCrash?.admission_kind} attempt=${afterCrash?.attempt}`)
    report.assert(`${kind}-not-recorded-before-crash`, afterCrash?.state === "admitting", `state=${afterCrash?.state}`)

    const modelTurnsBefore = modelTurnsFor(fake, deliveryId)
    const restarted = await startTui(`tui-${kind}-restarted`, { args: ["--session", endpoint.sessionPath] })
    const again = await awaitTuiEndpoint(scratch, restarted, { exclude: registrySockets(scratch) })
    report.assert(`${kind}-restart-same-id`, again.durableId === endpoint.durableId, `before=${endpoint.durableId} after=${again.durableId}`)
    const row = await waitFor(async () => {
      const current = await deliveryRow(scratch.agentDir, deliveryId)
      return current?.state === "applied" ? current : undefined
    }, { label: `${kind} row applied after restart` })
    const entries = deliveryEntries(endpoint.sessionPath).filter((entry) => deliveryIdOf(entry) === deliveryId).length
    const listed = await omo(scratch, install, ["thread", "list", "--json"])
    const listedRow = Array.isArray(listed.json) ? listed.json.find((thread) => thread.thread_id === endpoint.durableId) : undefined
    report.assert(`${kind}-listed-same-id`, listedRow?.alive === true && listedRow.surface === "tui", JSON.stringify(listedRow ? { id: listedRow.thread_id, surface: listedRow.surface, alive: listedRow.alive } : listed.stdout.slice(0, 200)))
    const modelTurnsAfter = modelTurnsFor(fake, deliveryId)
    report.assert(
      `${kind}-one-entry-no-readmission`,
      entries === 1 && modelTurnsAfter - modelTurnsBefore === 0 && restarted.keystrokes === 0,
      `entries=${entries} admission_kind=${row.admission_kind} attempt=${row.attempt} model_turns_for_delivery before_restart=${modelTurnsBefore} after=${modelTurnsAfter}`,
    )
    await restarted.type("/exit")
    restarted.press("enter")
    await restarted.exited
  }
}, { patches: ["crash_after_admit"] })

function registrySockets(scratch) {
  return Bun.spawnSync(["sh", "-c", `cat ${scratch.agentDir}/rpc-host-daemon/*/endpoint.json 2>/dev/null`]).stdout.toString().match(/"socket":"[^"]+"/g)?.map((match) => match.slice(10, -1)) ?? []
}

/** Model requests that answered a delivery with this id (the delivery's header names it). */
function modelTurnsFor(fake, deliveryId) {
  return fake.requests.filter((request) => request.answer?.delivery?.delivery === deliveryId).length
}
