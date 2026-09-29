#!/usr/bin/env bun
/**
 * loop-guard (todo 16, IS-6 loop safety), three parts on real surfaces:
 *
 * 1. Cycle: three pty TUIs. A's user asks A to send to B; B's model, running on that delivery, sends
 *    to C; C's model, running on B's, sends to A. The third send closes A -> B -> C -> A under one
 *    causal root and is refused `loop_detected` (`guard: "cycle"`); A never receives it.
 * 2. Fan-out: one turn of A sends to 17 distinct live sessions (opened on one Desktop-thread shard
 *    host, `i-*`); 16 are accepted and exactly one is refused `overloaded` (`budget: "fanout"`).
 * 3. Burst: 9 concurrent `omo thread send`s to one target: 8 pass, the 9th is `overloaded`
 *    (`budget: "pair_rate"`, `retry_after_ms`); after 5 s of REAL wall time one more passes.
 *    TIME-UNDER-TEST EXCEPTION: the refill is the behavior under test, so this one wait is a
 *    deliberate 5 s wall-clock pause, recorded in the report; nothing else here waits on time.
 *
 * `--mutant`: runs against a build whose store worker answers "no cycle" (patch `cycle_check_off`).
 * Part 1 must then FAIL, which is the proof this scenario can fail. Give it its own `--evidence-dir`.
 */
import { allToolResults, assistantTexts, awaitTuiEndpoint, cliSend, deliveryEntries, hasFlag, openHostSession, runScenario, startShardHost, storeRows, waitFor } from "./lib/gateway.mjs"

const MUTANT = hasFlag("--mutant")
const FANOUT_TARGETS = 17
const BURST = 8
const REFILL_WAIT_MS = 5_000

await runScenario("loop-guard", async ({ report, fake, scratch, install, startTui }) => {
  report.log(MUTANT ? "MUTANT RUN: cycle check disabled in the store worker (patch cycle_check_off); part 1 is expected to FAIL" : "normal run")

  // ------------------------------------------------------------------ 1. cycle A -> B -> C -> A
  const tuis = {}
  for (const name of ["a", "b", "c"]) {
    const tui = await startTui(`tui-${name}`)
    const endpoint = await awaitTuiEndpoint(scratch, tui, { exclude: Object.values(tuis).map((entry) => entry.endpoint.socket) })
    await tui.submit(`/name tui-${name}`)
    tuis[name] = { tui, endpoint }
  }
  // Each hop's message carries the next hop's script, so every send runs in the turn the previous delivery caused.
  const hop3 = fake.script("cycle-c", [{ name: "thread_send", args: { thread: "tui-a", message: "QA-TOKEN-hop3 closes the loop" } }])
  const hop2 = fake.script("cycle-b", [{ name: "thread_send", args: { thread: "tui-c", message: `QA-TOKEN-hop2 ${hop3}` } }])
  const hop1 = fake.script("cycle-a", [{ name: "thread_send", args: { thread: "tui-b", message: `QA-TOKEN-hop1 ${hop2}` } }])
  const mark = fake.requests.length
  await tuis.a.tui.submit(hop1)
  const sends = await waitFor(() => {
    const results = allToolResults(fake, "thread_send", mark)
    return results.length >= 3 ? results : undefined
  }, { label: "three thread_send results (A->B, B->C, C->A)", timeoutMs: 120_000 })
  const [first, second, third] = sends
  report.assert("cycle-hop1-and-hop2-delivered", first?.kind === "ok" && second?.kind === "ok", `a->b=${first?.kind} b->c=${second?.kind}`)
  report.assert(
    "cycle-closing-send-refused",
    third?.kind === "error" && third.error?.code === "loop_detected" && third.error?.details?.guard === "cycle",
    JSON.stringify(third).slice(0, 400),
  )
  // Every chain delivery to A would share hop 1's root; there must be none.
  const [hop1Row] = await storeRows(scratch.agentDir, "SELECT root_id FROM deliveries WHERE delivery_id = ?", [first?.delivery_id ?? ""])
  const toA = await storeRows(scratch.agentDir, "SELECT delivery_id, state FROM deliveries WHERE root_id = ? AND target_durable_id = ?", [hop1Row?.root_id ?? "", tuis.a.endpoint.durableId])
  report.assert("cycle-nothing-reaches-a", toA.length === 0 && !assistantTexts(tuis.a.endpoint.sessionPath).some((text) => text.includes("QA-TOKEN-hop3")), `rows_to_a_under_root=${JSON.stringify(toA)} a_entries=${deliveryEntries(tuis.a.endpoint.sessionPath).length}`)

  // ------------------------------------------------------------------ 2. fan-out cap
  const shard = await startShardHost(scratch, install, `qa-loop-guard-${process.pid}`)
  const targets = []
  for (let index = 0; index < FANOUT_TARGETS; index += 1) targets.push((await openHostSession(shard.client, scratch.work)).durableId)
  report.assert("fanout-targets-open", new Set(targets).size === FANOUT_TARGETS, `targets=${targets.length} on ${shard.socket}`)
  const fanMark = fake.requests.length
  await tuis.a.tui.submit(fake.script("fanout", targets.map((thread, index) => ({ name: "thread_send", args: { thread, message: `QA-TOKEN-fan-${index}` } }))))
  const fanResults = await waitFor(() => {
    const results = allToolResults(fake, "thread_send", fanMark)
    return results.length >= targets.length ? results : undefined
  }, { label: `${targets.length} fan-out results`, timeoutMs: 120_000 })
  const accepted = fanResults.filter((result) => result?.kind === "ok").length
  const capped = fanResults.filter((result) => result?.kind === "error" && result.error?.code === "overloaded" && result.error?.details?.budget === "fanout")
  report.assert("fanout-cap-16", accepted === 16 && capped.length === 1, `accepted=${accepted} refused_fanout=${capped.length} ${JSON.stringify(capped[0]?.error ?? null).slice(0, 200)}`)

  // ------------------------------------------------------------------ 3. per-pair burst + real refill
  // The nine sends go out at once: one `omo thread send` takes about a second, so sequential sends
  // would refill tokens between them (5 s each) and the burst would measure the machine, not the cap.
  const burstTarget = targets[0]
  const burst = await Promise.all(Array.from({ length: BURST + 1 }, (_, index) => cliSend(scratch, install, burstTarget, `QA-TOKEN-burst-${index}`)))
  const passed = burst.filter((result) => result.json?.kind === "ok")
  const refused = burst.filter((result) => result.json?.kind === "error" && result.json.error?.code === "overloaded" && result.json.error?.details?.budget === "pair_rate" && result.json.error.details.retry_after_ms > 0)
  const stamps = (await storeRows(scratch.agentDir, "SELECT created_at FROM deliveries WHERE target_durable_id = ? AND body LIKE '%QA-TOKEN-burst-%'", [burstTarget])).map((row) => Number(row.created_at))
  const spreadMs = stamps.length === 0 ? 0 : Math.max(...stamps) - Math.min(...stamps)
  // Tokens are real time: a bucket of 8 plus one per 5 s elapsed between the first and last admission.
  const allowed = Math.min(BURST + 1, BURST + Math.floor(spreadMs / 5_000))
  report.assert(
    "burst-8-then-refused",
    passed.length === allowed && refused.length === BURST + 1 - allowed && refused.length >= 1,
    `passed=${passed.length} refused_pair_rate=${refused.length} allowed_by_clock=${allowed} spread_ms=${spreadMs} refusal=${JSON.stringify(refused[0]?.json?.error ?? null).slice(0, 200)}`,
  )
  report.log(`TIME-UNDER-TEST EXCEPTION: waiting ${REFILL_WAIT_MS} ms of real wall time for one pair-bucket token to refill`)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, REFILL_WAIT_MS))
  const refilled = await cliSend(scratch, install, burstTarget, "QA-TOKEN-burst-after-refill")
  report.assert("burst-refills-after-5s", refilled.json?.kind === "ok", refilled.stdout.trim().slice(0, 200))
}, MUTANT ? { patches: ["gateway_send", "cycle_check_off"], installName: "omo-ai-loop-guard-mutant" } : {})
