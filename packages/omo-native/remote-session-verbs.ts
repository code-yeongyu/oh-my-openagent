import { handleOf, relayUnavailable, resolveTypedAddress } from "../omo-senpi/src/components/remote/index"
import type { RemoteCommandDependencies } from "./remote-local"
import { REMOTE_EXIT } from "./remote-exit"
import { closeLines, interruptLines, modelLines } from "./remote-render"
import { STDIN_TEXT, type SessionArgs } from "./remote-session-args"
import { type PersonRemote, type Refusal, sessionAnswer } from "./remote-session-answer"
import { openOn } from "./remote-session-open"
import { sendTo } from "./remote-session-send"

export type { PersonRemote } from "./remote-session-answer"

/**
 * The session verbs (design v8-core r2, 4c-2; Appendix A): thin callers of the person client. The relay is checked
 * first, the typed target is resolved by the one address resolver over the client's surface, and each verb is one
 * `sessions.*` member call (a waiting send is its follow plus the send).
 */
export async function runSession(
  remote: PersonRemote,
  args: SessionArgs,
  json: boolean,
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  const answer = sessionAnswer(json, dependencies)
  // omo remote needs the relay: a device service that is off, signed out or not set up is host_unavailable naming its
  // state, for every verb. The address module would read those states as "no relay here" and search this device's
  // (empty) book, answering not_found (#14305 delta review H1).
  const unavailable = await relayUnavailable(remote.surface)
  if (unavailable !== undefined) return answer.refuse(unavailable.error, "")
  if (args.verb === "open") return openOn(remote.client, args, answer)
  // The typed text is resolved by the one address resolver (#14305): a bare thread id, name, alias or id prefix, or
  // `<device>/<thread>` with the device by id, name, prefix or `here`. A send needs only the address (its delivery
  // queues); the control verbs need the device online, refused there by the resolver itself.
  const resolved = await resolveTypedAddress(remote.surface, args.target, {
    need: args.verb === "send" ? "address" : "online",
  })
  if (resolved.kind === "error") return answer.refuse(resolved.error, args.target)
  const { row } = resolved.where
  // A listing key the person typed names the session in every --json answer (its handle, at `thread`), as before the
  // address module (#14305 delta review 2, M2); any other address names it by its durable id. The output names it by
  // its address.
  const typedKey = args.target === row.session_id || args.target.endsWith(`/${row.session_id}`)
  const thread = handleOf(row.device, typedKey ? row.session_id : (row.durable_id ?? row.session_id))
  const label = resolved.address
  const { sessions } = remote.client
  switch (args.verb) {
    case "send": {
      // omo#13905: `omo remote send <target> -` reads the message text from stdin; an empty stdin is a usage error.
      const text = args.text === STDIN_TEXT ? await (dependencies.readStdin ?? readProcessStdin)() : args.text
      if (text === "") {
        dependencies.error("omo remote send: stdin was empty; pipe the message text in, or pass it as an argument")
        return REMOTE_EXIT.usage
      }
      return sendTo(remote.client, thread, label, { ...args, text }, answer)
    }
    case "model": {
      const set = await sessions.setModel(thread, args.model)
      return set.kind === "error"
        ? answer.refuse(set, label)
        : answer.ok({ thread, ...set.value }, modelLines(label, set.value.model))
    }
    case "interrupt": {
      const interrupted = await sessions.interrupt(thread)
      if (interrupted.kind === "error") return answer.refuse(interrupted, label)
      return answer.ok(interrupted.value, interruptLines(label, interrupted.value))
    }
    case "close": {
      const closed = await sessions.close(thread, {
        force: args.force,
        ...(args.graceful === undefined ? {} : { graceful: args.graceful }),
        ...(args.wait_ms === undefined ? {} : { wait_ms: args.wait_ms }),
      })
      if (closed.kind === "error") return answer.refuse(withForceHint(closed, label), label)
      // omo#13905: a close that closed nothing fails; a script must never read a miss as success while it may still run.
      if (!closed.value.closed)
        return answer.refuse(
          {
            code: "not_found",
            message: `${label} is not open on its device, so nothing was closed.`,
            next_action:
              "Run omo remote sessions to see the sessions each device holds, then close one by its address.",
            details: { thread: label },
          },
          label,
        )
      return answer.ok({ thread, ...closed.value }, closeLines(label, closed.value))
    }
  }
}

/**
 * A close the engine refused because the session has messages it has not read (omo#14234) names the CLI's own option:
 * the module's hint names `force`, which this command takes as `--force`, and the ids (or `unavailable`) are printed.
 */
function withForceHint<R extends Refusal>(refusal: R, label: string): R {
  const pending = refusal.details?.["pending_deliveries"]
  if (pending === undefined) return refusal
  const ids = Array.isArray(pending)
    ? `messages it has not read: ${pending.join(", ")}`
    : "message ids: unavailable on that device's engine"
  return {
    ...refusal,
    next_action: `${ids}. Run omo remote close ${label} --force to close it anyway; those messages are dropped.`,
  }
}

/** The whole of this process's stdin as UTF-8, for `omo remote send <target> -` (omo#13905). */
async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}
