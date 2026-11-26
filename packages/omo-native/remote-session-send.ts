import type { RemoteClient, SendReceipt, ThreadHandle } from "../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "./remote-exit"
import { sendLines, sendWaitNotice, sessionEndedLine } from "./remote-render"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { SessionArgs } from "./remote-session-args"
import type { Answer, Refusal } from "./remote-session-answer"

type Send = Extract<SessionArgs, { readonly verb: "send" }>

// #13425: a waiting send follows its turn for --timeout seconds (default 120), then answers a typed timeout.
const DEFAULT_WAIT_MS = 120_000

/**
 * `omo remote send`: the person's own input as a prompt (#12882), one `sessions.send`. A waiting send (the default)
 * follows the session BEFORE it sends, so no record of the turn it starts arrives unseen, and hands the follow the send's
 * receipt as it settles (F1): only that send's turn prints, and only its end ends the wait (#13267).
 */
export async function sendTo(
  client: RemoteClient,
  thread: ThreadHandle,
  label: string,
  args: Send,
  answer: Answer,
): Promise<number> {
  const { json, dependencies } = answer
  const refuse = (refusal: Refusal): number => {
    if (refusal.code !== "not_steerable" || json) return answer.refuse(refusal, label)
    dependencies.error(escapeForDisplay(`omo remote: nothing is running on ${label} to steer.`))
    dependencies.error("Send without --steer to start a turn.")
    return REMOTE_EXIT.failed
  }
  const request = { text: args.text, mode: args.delivery }
  if (!args.wait) {
    const sent = await client.sessions.send(thread, request)
    return sent.kind === "error" ? refuse(sent) : answer.ok(sent.value, sendLines(label, sent.value))
  }
  const waitMs = args.timeout_seconds === undefined ? DEFAULT_WAIT_MS : args.timeout_seconds * 1000
  let settle: { resolve: (receipt: SendReceipt) => void; reject: (failure: Refusal) => void } | undefined
  const receipt = new Promise<SendReceipt>((resolve, reject) => (settle = { resolve, reject }))
  const stream = client.sessions.follow(thread, { from: receipt, deadlineMs: waitMs })
  try {
    const sent = await client.sessions.send(thread, request)
    if (sent.kind === "error") {
      settle?.reject(sent)
      return refuse(sent)
    }
    settle?.resolve(sent.value)
    // A send that waits behind a running turn says so at once (#13268); under --json the notice rides the final JSON
    // value instead of stderr, so one JSON value always carries it (#13425).
    const notice = sendWaitNotice(label, sent.value)
    if (notice !== null && !json) dependencies.error(escapeForDisplay(notice))
    const typed = { ...sent.value, ...(notice === null ? {} : { queued_notice: notice }) }
    let reply = ""
    for await (const event of stream) {
      if (event.kind === "text") {
        reply += event.delta
        if (!json) dependencies.write(event.delta)
        continue
      }
      if (event.kind !== "end" && event.kind !== "failed") continue
      if (!json && reply.length > 0 && !reply.endsWith("\n")) dependencies.write("\n")
      if (event.kind === "failed") return timedOut(event.failure, typed, label, waitMs, answer)
      const { reason } = event.outcome
      if (reason === "settled") return answer.ok({ ...typed, reply }, [])
      if (reason === "interrupted") {
        dependencies.error(escapeForDisplay(`omo remote: the turn on ${label} was interrupted before it finished.`))
        return REMOTE_EXIT.failed
      }
      if (json) dependencies.output(JSON.stringify({ ...typed, kind: "session_ended", end: reason }))
      else dependencies.error(sessionEndedLine(sent.value.device.id, String(reason)))
      return REMOTE_EXIT.failed
    }
    dependencies.error(escapeForDisplay(`omo remote: the follow of ${label} stopped before its turn settled.`))
    return REMOTE_EXIT.failed
  } finally {
    stream.stop()
  }
}

/** A follow that ended without the turn's end: its deadline (a typed timeout, #13425), or the follow's own failure. */
function timedOut(failure: Refusal, typed: object, label: string, waitMs: number, answer: Answer): number {
  if (failure.code !== "timeout") return answer.refuse(failure, label)
  if (answer.json)
    answer.dependencies.output(
      JSON.stringify({
        ...typed,
        kind: "timeout",
        waited_ms: waitMs,
        next_action: "The message was delivered; read the thread to see its answer when the turn settles.",
      }),
    )
  else
    answer.dependencies.error(
      escapeForDisplay(
        `omo remote: the turn on ${label} did not settle within ${Math.round(waitMs / 1000)} s; read the thread later.`,
      ),
    )
  return REMOTE_EXIT.failed
}
