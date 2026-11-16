import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type { RemoteClient } from "../omo-senpi/src/components/remote/client"
import { handleOf } from "../omo-senpi/src/components/remote/seams"
import type {
  FollowEvent,
  PermissionPreset,
  R,
  RemoteFailure,
  SendReceipt,
  ThreadHandle,
} from "../omo-senpi/src/components/remote/types"
import { GATEWAY_STORE_WORKER_BUNDLE_NAME } from "../omo-senpi/src/components/thread/gateway/store"
import { packageRoot } from "./bin/lib/package-paths.js"
import type { RemoteCommandDependencies } from "./remote-local"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { localPermissionPreset } from "./remote-permission-preset"
import { awaitingApprovalLines, sendWaitNotice, sessionVerbLines } from "./remote-render"
import type { SessionArgs } from "./remote-session-args"

/**
 * Where the gateway store's worker is in the shipped `omo`: the `gateway-store-worker.mjs` sidecar beside the plugin's
 * extension bundle (`<package>/plugin/extensions/`), the one place the payload carries it; `bin/lib` holds no worker, so
 * the store's default (a worker beside the module it runs in) finds nothing there. From source the sidecar is absent and
 * the store resolves `store-worker.ts` itself. Returns the anchor the store resolves the sidecar from, or undefined.
 */
export function gatewayWorkerAnchor(root: string = packageRoot): URL | undefined {
  const anchor = pathToFileURL(join(root, "plugin", "extensions", "omo.js"))
  return existsSync(new URL(`./${GATEWAY_STORE_WORKER_BUNDLE_NAME}`, anchor)) ? anchor : undefined
}

type Fail = (failure: RemoteFailure, label: string) => number
type Answer<T> = Awaited<R<T>>

/**
 * The session verbs (design v8-core r2, 4c-2; Appendix A): each is one member call on the person client (a waited send
 * is its follow stream plus the send), and --json prints that call's value as is. Waiting is the default for send.
 */
export async function runSession(
  client: RemoteClient,
  args: SessionArgs,
  json: boolean,
  dependencies: RemoteCommandDependencies,
  fail: Fail,
): Promise<number> {
  const show = <T>(answer: Answer<T>, label: string, human: (value: T) => readonly string[]): number => {
    if (answer.kind === "error") return fail(answer, label)
    if (json) dependencies.output(JSON.stringify(answer.value))
    else for (const line of human(answer.value)) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  if (args.verb === "open") {
    // A session this person starts on another device gets this device's own approval mode unless named (#6189): the
    // person's setting lives here, not on the device that hosts the session.
    let preset: PermissionPreset
    try {
      preset = args.permissionPreset ?? (dependencies.localPermissionPreset ?? localPermissionPreset)()
    } catch (error) {
      if (!(error instanceof UsageError)) throw error
      dependencies.error(error.message)
      return REMOTE_EXIT.usage
    }
    const opened = await client.sessions.open({
      device: args.device,
      preset,
      ...(args.project === undefined ? {} : { workspace: args.project }),
      ...(args.model === undefined ? {} : { model: args.model }),
    })
    return show(opened, "", (value) => sessionVerbLines({ verb: "open", thread: value.thread }))
  }
  const thread = handleOf(args.target.device, args.target.session)
  switch (args.verb) {
    case "send":
      return args.wait
        ? sendAndFollow(client, thread, args, json, dependencies, fail)
        : show(await client.sessions.send(thread, { text: args.text, mode: args.delivery }), thread, (receipt) =>
            sessionVerbLines({ verb: "send", thread, receipt }),
          )
    case "model":
      return show(await client.sessions.setModel(thread, args.model), thread, ({ model }) =>
        sessionVerbLines({ verb: "model", thread, model }),
      )
    case "interrupt":
      return show(await client.sessions.interrupt(thread), thread, (result) =>
        sessionVerbLines({ verb: "interrupt", thread, interrupted: result.interrupted }),
      )
    case "close":
      return show(await client.sessions.close(thread), thread, ({ closed }) =>
        sessionVerbLines({ verb: "close", thread, closed }),
      )
  }
}

/**
 * A waited send: the follow stream opens BEFORE the send, so no delta of the turn it starts arrives unseen; stdout is the
 * answer as it streams (--jsonl: one FollowEvent per line), stderr the queue position and any approval it waits on.
 */
async function sendAndFollow(
  client: RemoteClient,
  thread: ThreadHandle,
  args: Extract<SessionArgs, { readonly verb: "send" }>,
  json: boolean,
  dependencies: RemoteCommandDependencies,
  fail: Fail,
): Promise<number> {
  const stream = client.sessions.follow(
    thread,
    args.timeoutMs === undefined ? undefined : { deadlineMs: args.timeoutMs },
  )
  try {
    const sent = await client.sessions.send(thread, { text: args.text, mode: args.delivery })
    if (sent.kind === "error") return fail(sent, thread)
    const receipt: SendReceipt = sent.value
    if (args.jsonl) dependencies.output(JSON.stringify({ kind: "receipt", receipt } satisfies FollowEvent))
    const notice = sendWaitNotice(thread, receipt)
    if (notice !== null && !json && !args.jsonl) dependencies.error(notice)
    let reply = ""
    for await (const event of stream) {
      if (args.jsonl) dependencies.output(JSON.stringify(event))
      if (event.kind === "text") {
        reply += event.delta
        if (!json && !args.jsonl) dependencies.write(event.delta)
      } else if (event.kind === "waiting" && event.state === "awaiting_approval" && !args.jsonl) {
        for (const line of awaitingApprovalLines(thread, event)) dependencies.error(line)
      } else if (event.kind === "failed") return fail(event.failure, thread)
      else if (event.kind === "end") {
        if (!json && !args.jsonl && reply.length > 0 && !reply.endsWith("\n")) dependencies.write("\n")
        if (event.outcome.reason !== "settled") {
          dependencies.error(`omo remote: ${thread} ended before its turn settled (${event.outcome.reason}).`)
          return REMOTE_EXIT.failed
        }
        if (json) dependencies.output(JSON.stringify({ ...receipt, reply }))
        return REMOTE_EXIT.ok
      }
    }
    dependencies.error(`omo remote: the follow of ${thread} stopped before its turn settled.`)
    return REMOTE_EXIT.failed
  } finally {
    stream.stop()
  }
}
