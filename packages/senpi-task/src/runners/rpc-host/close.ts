import { log } from "@oh-my-opencode/utils"

import type { HostSessionIdentity } from "../../state"
import { HostSessionClient } from "./session-client"
import type { HostSessionPort } from "./handle-port"

/**
 * THE single writer that ends a daemon session this process does not hold a handle for: cancel, TTL
 * and reconciliation all route here. It attaches to the recorded session path, aborts whatever turn
 * is in flight, and issues `close_session`. It NEVER signals a pid - the only pid on the other end
 * is the machine-wide daemon's, which belongs to no child (invariant I1).
 *
 * A daemon that does not answer is not an error: the session is either already gone or will be
 * parked, and the caller's record bookkeeping is the same either way.
 */

export type HostSessionCloseOutcome = "closed" | "unreachable"

export type HostSessionCloseInput = {
  readonly hostSession: HostSessionIdentity
  /** The child's recorded cwd; the daemon needs one to open a session, and it never changes here. */
  readonly cwd?: string
}

/** The seam a suite drives: an attachable session that can be aborted and closed. */
export interface HostSessionCloseChannel extends Pick<HostSessionPort, "send" | "close"> {
  open(input: { readonly sessionPath: string; readonly cwd: string }): Promise<unknown>
  detach(): Promise<void>
}

export type HostSessionClosePorts = {
  readonly createChannel?: (socket: string) => HostSessionCloseChannel
}

function defaultChannel(socket: string): HostSessionCloseChannel {
  const client = new HostSessionClient({ socketPath: socket })
  return {
    // Re-attaching to close: `retain_on_disconnect` is false so a failure mid-teardown cannot leave
    // the session pinned, and the worker kind keeps it out of every interactive session list.
    open: (input) =>
      client.open({
        sessionPath: input.sessionPath,
        cwd: input.cwd,
        kind: "worker",
        context: {},
        retainOnDisconnect: false,
        autoTitle: false,
      }),
    send: (command) => client.send(command),
    close: () => client.close(),
    detach: () => client.detach(),
  }
}

export async function closeHostSession(
  input: HostSessionCloseInput,
  ports: HostSessionClosePorts = {},
): Promise<HostSessionCloseOutcome> {
  const channel = (ports.createChannel ?? defaultChannel)(input.hostSession.socket)
  try {
    await channel.open({ sessionPath: input.hostSession.session_path, cwd: input.cwd ?? process.cwd() })
  } catch (error) {
    log("senpi-task host session close could not attach", {
      sessionPath: input.hostSession.session_path,
      error: String(error),
    })
    await channel.detach().catch(() => undefined)
    return "unreachable"
  }
  try {
    await channel.send({ type: "abort" }).catch((error: unknown) => {
      log("senpi-task host session close abort rejected", { error: String(error) })
    })
    await channel.close()
    return "closed"
  } catch (error) {
    log("senpi-task host session close_session rejected", {
      sessionPath: input.hostSession.session_path,
      error: String(error),
    })
    await channel.detach().catch(() => undefined)
    return "unreachable"
  }
}
