#!/usr/bin/env bun
/**
 * tui-to-tui (todo 16, IS-4 / IS-6): two real pty OmO TUIs on the released engine reach each other
 * with `thread_send`, both ways, through the gateway.
 *
 * Proven on target state:
 * - `omo thread list --json` lists both terminals with `surface: "tui"`, the names set with `/name`
 *   and real `created_at`/`updated_at` (not the epoch);
 * - A -> B: the idle target B admits the delivery as `started` (store row) and answers it (its own
 *   transcript) while this harness writes NOTHING to B's pty; B's screen shows the provenance header;
 * - B -> A: the same the other way, as a fresh user turn in B (a new causal root, so not a cycle).
 */
import { awaitToolResult, awaitTuiEndpoint, assistantTexts, callDirective, deliveryEntries, deliveryIdOf, deliveryRow, omo, runScenario, waitFor } from "./lib/gateway.mjs"

const EPOCH_YEAR = 1970

await runScenario("tui-to-tui", async ({ report, fake, scratch, install, startTui }) => {
  const alpha = await startTui("tui-alpha")
  const alphaEndpoint = await awaitTuiEndpoint(scratch, alpha)
  const beta = await startTui("tui-beta")
  const betaEndpoint = await awaitTuiEndpoint(scratch, beta, { exclude: [alphaEndpoint.socket] })
  report.log(`alpha=${alphaEndpoint.durableId} beta=${betaEndpoint.durableId}`)

  await alpha.submit("/name tui-alpha")
  await beta.submit("/name tui-beta")
  const listed = await waitFor(async () => {
    const result = await omo(scratch, install, ["thread", "list", "--json"])
    const rows = Array.isArray(result.json) ? result.json : []
    const a = rows.find((row) => row.thread_id === alphaEndpoint.durableId)
    const b = rows.find((row) => row.thread_id === betaEndpoint.durableId)
    return a?.name === "tui-alpha" && b?.name === "tui-beta" ? rows : undefined
  }, { label: "omo thread list shows both names", timeoutMs: 30_000 })
  const realTimes = (row) => [row.created_at, row.updated_at].every((stamp) => typeof stamp === "string" && new Date(stamp).getUTCFullYear() > EPOCH_YEAR)
  const rows = listed.filter((row) => row.thread_id === alphaEndpoint.durableId || row.thread_id === betaEndpoint.durableId)
  report.assert(
    "list-both-terminals-named",
    rows.length === 2 && rows.every((row) => row.surface === "tui" && row.endpoint?.kind === "tui" && realTimes(row)),
    JSON.stringify(rows.map((row) => ({ id: row.thread_id, name: row.name, surface: row.surface, endpoint: row.endpoint?.kind, created_at: row.created_at, updated_at: row.updated_at }))),
  )

  for (const [sender, senderEndpoint, target, targetEndpoint, targetName, token] of [
    [alpha, alphaEndpoint, beta, betaEndpoint, "tui-beta", "QA-TOKEN-a2b"],
    [beta, betaEndpoint, alpha, alphaEndpoint, "tui-alpha", "QA-TOKEN-b2a"],
  ]) {
    const direction = `${sender.label}->${target.label}`
    const keystrokesBefore = target.keystrokes
    const mark = fake.requests.length
    await sender.submit(callDirective("thread_send", { thread: targetName, message: `${token} hello from ${sender.label}` }))
    const sent = await awaitToolResult(fake, "thread_send", mark, { label: `${direction} thread_send result` })
    report.assert(`${direction}-send-ok`, sent?.kind === "ok" && typeof sent.delivery_id === "string", JSON.stringify(sent).slice(0, 400))
    const deliveryId = sent?.delivery_id
    const entry = await waitFor(
      () => deliveryEntries(targetEndpoint.sessionPath).find((candidate) => deliveryIdOf(candidate) === deliveryId),
      { label: `${direction} delivery entry in the target transcript`, timeoutMs: 60_000 },
    )
    await waitFor(() => assistantTexts(targetEndpoint.sessionPath).some((text) => text.includes(`QA-ACK ${token}`)), { label: `${target.label} answers ${token}` })
    const row = await waitFor(async () => {
      const current = await deliveryRow(scratch.agentDir, deliveryId)
      return current?.state === "applied" ? current : undefined
    }, { label: `${direction} row applied` })
    report.assert(`${direction}-idle-target-started`, row.admission_kind === "started" && row.target_durable_id === targetEndpoint.durableId, `state=${row.state} admission_kind=${row.admission_kind} target=${row.target_durable_id}`)
    report.assert(`${direction}-no-keystroke-on-target`, target.keystrokes === keystrokesBefore, `target pty bytes written by harness during delivery: ${target.keystrokes - keystrokesBefore}`)
    report.assert(`${direction}-single-entry`, deliveryEntries(targetEndpoint.sessionPath).filter((candidate) => deliveryIdOf(candidate) === deliveryId).length === 1, `delivery_id=${deliveryId}`)
    const envelope = JSON.parse(row.envelope)
    report.assert(
      `${direction}-provenance-sender`,
      JSON.stringify(envelope).includes(senderEndpoint.durableId) && entry !== undefined,
      `envelope=${row.envelope.slice(0, 300)}`,
    )
    // The header wraps at the terminal width, so it is matched with the layout whitespace removed.
    const flat = (text) => text.replace(/\s+/g, "")
    const screen = await target.waitScreen(
      (text) => flat(text).includes("[OMO_GATEWAYv=1source=peer_agent") && flat(text).includes(`delivery=${deliveryId}`) && flat(text).includes(`sender_session=${senderEndpoint.durableId}`),
      { label: `${direction} provenance header visible on the target`, scope: "history", timeoutMs: 30_000 },
    ).catch((error) => error)
    report.assert(`${direction}-provenance-visible`, typeof screen === "string", typeof screen === "string" ? `header rendered: source=peer_agent sender_session=${senderEndpoint.durableId} delivery=${deliveryId}` : String(screen.message))
  }
})
