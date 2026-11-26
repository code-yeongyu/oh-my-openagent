import { randomUUID } from "node:crypto"

import { askHost } from "../../../../../senpi-task/src/runners/rpc-host/host-request"
import { classifyWarmReply, type WarmAnswer } from "../../../../../senpi-task/src/runners/rpc-host/host-warm-reply"
import type { ReleaseSessionReply, ReleaseSessionRequest } from "../gateway/adapter"
import { resolveThreadSocket } from "../live-surface-paths"
import type { ThreadCoreContext } from "./context"
import type { Failure } from "./failures"
import type { LocatedThread } from "./reads"

// The first load compiles the extension graph; a loaded host answers in well under a second (the task host's bound).
const DAEMON_WARM_TIMEOUT_MS = 60_000

export type CoreReleaseRequest = Omit<ReleaseSessionRequest, "reason">

export function createLifecycle(
  context: ThreadCoreContext,
  locate: (request: {
    readonly thread: string
    readonly all_scope?: boolean
  }) => Promise<{ readonly kind: "ok"; readonly thread: LocatedThread } | Failure>,
) {
  const { options, env, host, store } = context
  /** senpi `release_session` on the host that serves `thread`; a thrown transport failure is answered as `host_unavailable`. */
  async function releaseRow(thread: LocatedThread, request: CoreReleaseRequest): Promise<ReleaseSessionReply> {
    const releaseSession = host.gateway?.releaseSession
    if (releaseSession === undefined || thread.endpoint === null)
      return { success: false, error: "release_unsupported" }
    try {
      return await releaseSession(thread.endpoint, { reason: "takeover", ...request })
    } catch (error) {
      const failure = context.fault(error)
      return { success: false, error: failure.error.code, errorData: { hint: failure.error.message } }
    }
  }
  return {
    releaseRow,
    /** The root's release: the thread is located on this call, then released where it is served. */
    release: async (
      request: CoreReleaseRequest & { readonly thread: string },
    ): Promise<{ readonly kind: "ok"; readonly value: ReleaseSessionReply } | Failure> => {
      const { thread, ...flags } = request
      const found = await locate({ thread })
      if (found.kind === "error") return found
      return { kind: "ok", value: await releaseRow(found.thread, flags) }
    },
    /**
     * senpi's `warm` on the operator daemon (`omo daemon run`, after its ensure): the host loads omo with no session open,
     * so its thread component starts the wake and declares the delivery consumer at once (#13037 cold wake).
     */
    warm: async (): Promise<WarmAnswer> =>
      classifyWarmReply(
        await askHost(
          resolveThreadSocket(env),
          { id: `omo-daemon-warm-${randomUUID()}`, type: "warm" },
          DAEMON_WARM_TIMEOUT_MS,
          { agentDir: options.agentDir },
        ),
      ),
    dispose: async (): Promise<void> => {
      await options.remote?.sessions.close?.().catch(() => undefined)
      return store.dispose()
    },
  }
}
