#!/usr/bin/env bun
/**
 * report-origin (review of #9222): a terminal session bound to two chat threads. Thread A's message
 * starts a run that stays streaming; thread B's message queues behind it. When the run's answer to A
 * ends, the released engine takes B's follow-up before the run settles, and the model answers it with
 * a `thread_report` that names no binding. The report must reach B, the thread that asked, and not A,
 * the thread whose message started the run.
 */
import { assistantTexts, awaitToolResult, awaitTuiEndpoint, callDirective, deliveryRow, holdDirective, omo, runScenario, waitFor } from "./lib/gateway.mjs"

await runScenario("report-origin", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  const bind = (chat) => omo(scratch, install, ["thread", "bind", target.durableId, "--platform", "slack", "--account", "bot-account", "--chat", chat, "--thread", "t1", "--json"])
  const a = (await bind("chat-a")).json?.binding?.binding_id
  const b = (await bind("chat-b")).json?.binding?.binding_id
  report.assert("two-bindings", typeof a === "string" && typeof b === "string", `a=${a} b=${b}`)

  const fromA = await omo(scratch, install, ["thread", "send", "--binding", a, "--idempotency-key", "evt-a", `${holdDirective("ro-a")} QA-TOKEN-from-a`, "--json"])
  report.assert("a-sent", fromA.code === 0 && fromA.json?.kind === "ok", `exit=${fromA.code} ${fromA.stdout.trim().slice(0, 300)}`)
  await waitFor(() => fake.heldTags().includes("ro-a"), { label: "A's answer streaming" })

  const fromB = await omo(scratch, install, ["thread", "send", "--binding", b, "--idempotency-key", "evt-b", callDirective("thread_report", { kind: "report", text: "answer-for-b" }), "--json"])
  report.assert("b-sent", fromB.code === 0 && fromB.json?.kind === "ok", `exit=${fromB.code} ${fromB.stdout.trim().slice(0, 300)}`)
  const admitted = async (id) => (await waitFor(async () => (await deliveryRow(scratch.agentDir, id))?.admission_kind ?? undefined, { label: `admission of ${id}` }))
  const kinds = { a: await admitted(fromA.json?.delivery_id), b: await admitted(fromB.json?.delivery_id) }
  report.assert("a-started-b-queued-behind-it", kinds.a === "started" && kinds.b === "queued", JSON.stringify(kinds))

  const from = fake.requests.length
  report.assert("release-a", fake.release("ro-a"), "A's answer released")
  const reported = await awaitToolResult(fake, "thread_report", from, { label: "the report answering B" })
  report.assert("report-resolves-to-b", reported?.kind === "ok" && reported.binding_id === b, `${JSON.stringify(reported).slice(0, 400)} a=${a} b=${b}`)
  await waitFor(() => assistantTexts(target.sessionPath).some((text) => text.includes("QA-RELEASED ro-a")), { label: "A's answer in the transcript" })

  const outbox = async (bindingId) => (await omo(scratch, install, ["thread", "outbox", bindingId, "--after", "0", "--json"])).json?.rows?.map((row) => row.text) ?? null
  const rows = { a: await outbox(a), b: await outbox(b) }
  report.assert("only-b-outbox-has-the-row", JSON.stringify(rows) === JSON.stringify({ a: [], b: ["answer-for-b"] }), JSON.stringify(rows))
})
