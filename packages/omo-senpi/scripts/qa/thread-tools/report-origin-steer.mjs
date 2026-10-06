#!/usr/bin/env bun
/**
 * report-origin-steer (review of #9222, round 4): a terminal session bound to ONE chat thread A. A's
 * message starts a run whose tool call is held; the user types a prompt into the session's terminal
 * meanwhile, so it is queued as a steer and enters A's run at the tool boundary, in the same answer as
 * A's message. The model then reports without naming a binding. With A as the only outbound binding,
 * both inputs can only be answered in A, so the report must reach A and not be refused. senpi's
 * ask_user steers a non-blocking answer in through the same path (`sendUserMessage` with
 * `deliverAs: "steer"` -> `_queueSteer`), as the same plain user message.
 */
import { awaitToolResult, awaitTuiEndpoint, callDirective, deliveryRow, holdDirective, omo, runScenario, waitFor } from "./lib/gateway.mjs"

await runScenario("report-origin-steer", async ({ report, fake, scratch, install, startTui }) => {
  const tui = await startTui("tui-target")
  const target = await awaitTuiEndpoint(scratch, tui)
  const a = (await omo(scratch, install, ["thread", "bind", target.durableId, "--platform", "slack", "--account", "bot-account", "--chat", "chat-a", "--thread", "t1", "--json"])).json?.binding?.binding_id
  report.assert("one-binding", typeof a === "string", `a=${a}`)

  const fromA = await omo(scratch, install, ["thread", "send", "--binding", a, "--idempotency-key", "evt-a", `${holdDirective("ros-a")} ${callDirective("thread_report", { kind: "report", text: "a-step" })}`, "--json"])
  report.assert("a-sent", fromA.code === 0 && fromA.json?.kind === "ok", `exit=${fromA.code} ${fromA.stdout.trim().slice(0, 300)}`)
  await waitFor(() => fake.heldTags().includes("ros-a"), { label: "A's tool call held" })
  const kind = await waitFor(async () => (await deliveryRow(scratch.agentDir, fromA.json?.delivery_id))?.admission_kind ?? undefined, { label: "admission of A" })
  report.assert("a-started-the-run", kind === "started", `admission_kind=${kind}`)

  const steer = `also check the tests ${fake.script("ros-steer", [{ name: "thread_report", args: { kind: "report", text: "after-the-steer" } }])}`
  await tui.submit(steer)
  await tui.waitScreen("also check the tests", { label: "the typed prompt queued as a steer" })

  const from = fake.requests.length
  report.assert("release-a", fake.release("ros-a"), "A's tool call released")
  // The steer enters at the tool boundary: the request that answers it carries A's tool result followed by the typed prompt.
  const steered = await waitFor(() => fake.requests.slice(from).find((request) => request.answer?.kind === "tool_calls" && request.answer.calls.some((call) => call.args?.text === "after-the-steer")), { label: "the model answering the steer in A's run" })
  const lastUser = [...steered.messages].reverse().find((message) => message.role === "user")
  const toolMessage = [...steered.messages].reverse().find((message) => message.role === "tool")
  report.assert("steer-entered-a-run-at-the-tool-boundary", steered.messages.at(-1)?.role === "user" && toolMessage !== undefined, `last=${steered.messages.at(-1)?.role} user=${JSON.stringify(lastUser?.content).slice(0, 200)}`)
  const toolText = typeof toolMessage?.content === "string" ? toolMessage.content : (toolMessage?.content ?? []).map((part) => part?.text ?? "").join("")
  let first
  try {
    const parsed = JSON.parse(toolText)
    first = parsed?.details?.result ?? parsed?.result ?? parsed
  } catch {
    first = { unparsed: toolText }
  }
  report.assert("a-step-resolves-to-a", first?.kind === "ok" && first.binding_id === a, `${JSON.stringify(first).slice(0, 400)} a=${a}`)
  const after = fake.requests.indexOf(steered)
  const reported = await awaitToolResult(fake, "thread_report", after, { label: "the report after the steer" })
  report.assert("steered-report-resolves-to-a", reported?.kind === "ok" && reported.binding_id === a, `${JSON.stringify(reported).slice(0, 400)} a=${a}`)

  const rows = (await omo(scratch, install, ["thread", "outbox", a, "--after", "0", "--json"])).json?.rows?.map((row) => row.text) ?? null
  report.assert("a-outbox-has-both-rows", JSON.stringify(rows) === JSON.stringify(["a-step", "after-the-steer"]), JSON.stringify(rows))
})
