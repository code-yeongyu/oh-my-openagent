import type { ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"
import { answered, setModelOn } from "../omo-senpi/src/components/thread/control/operations"
import { createRelayControl } from "../omo-senpi/src/components/thread/control/relay-control"
import { createRelaySessionHost } from "../omo-senpi/src/components/thread/control/relay-session-host"
import { namedDeviceRow } from "../omo-senpi/src/components/thread/remote/address-book"
import type { RemoteSessionRow, RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import type { RemoteCommandDependencies } from "./remote-local"
import { localPermissionPreset } from "./remote-permission-preset"
import type { SessionArgs } from "./remote-session-args"

export async function openOn(
  remote: RemoteThreadSurface,
  args: Extract<SessionArgs, { readonly verb: "open" }>,
  { json, show }: { readonly json: boolean; readonly show: (result: ThreadToolResult, label: string) => number },
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  let mode: string
  try {
    mode = args.permissionPreset ?? (dependencies.localPermissionPreset ?? localPermissionPreset)()
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    dependencies.error(error.message)
    return REMOTE_EXIT.usage
  }
  const open = await createRelaySessionHost(remote, args.device).open({
    permissionPreset: mode,
    ...(args.project === undefined ? {} : { cwd: args.project }),
  })
  if (open.kind !== "ok") return show(open, "")
  const opened = { kind: "ok" as const, thread: open.thread, deduplicated: false }
  const wanted = args.model
  if (wanted === undefined) return show(opened, "")
  const label = `${args.device}/${open.thread.thread_id}`
  const created: RemoteSessionRow = {
    ...namedDeviceRow(args.device, open.thread.thread_id),
    // RelaySessionHost already located and attached this session. Preserve its route rather than rebuilding it
    // from the durable identity; the account listing need not have caught up with this create yet.
    session_id: open.thread.sessionId,
    title: open.thread.name,
    project: open.thread.cwd,
  }
  const model = await answered(() => setModelOn(createRelayControl(remote, created), wanted, undefined))
  if (model.kind === "error") {
    if (json) dependencies.output(JSON.stringify({ ...model, thread: opened.thread }))
    else {
      dependencies.output(label)
      dependencies.error(`omo remote: opened ${label}, but its model was not set: ${model.error.message}`)
      dependencies.error(`${model.error.next_action} The session is still open; end it with omo remote close ${label}.`)
    }
    return REMOTE_EXIT.failed
  }
  if (!("model" in model)) return show(model, label)
  return show({ ...opened, model: model.model }, "")
}
